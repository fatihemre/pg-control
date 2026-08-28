import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api'
import { useInstance } from './instance'

export type ObjectKind = 'database' | 'schema' | 'table' | 'sequence' | 'function'
export type DefaultKind = 'tables' | 'sequences' | 'functions' | 'types' | 'schemas'

export type RoleAttributes = {
  superuser?: boolean
  createdb?: boolean
  createrole?: boolean
  inherit?: boolean
  login?: boolean
  replication?: boolean
  bypassrls?: boolean
  connlimit?: number
  valid_until?: string
  password?: string
}

type ObjectRef = { kind: ObjectKind; schema?: string; name?: string; args?: string; all_in_schema?: boolean }

export type Change =
  | ({ op: 'grant'; grantee: string; privileges: string[]; grant_option?: boolean } & ObjectRef)
  | ({ op: 'revoke'; grantee: string; privileges: string[]; grant_option_only?: boolean; cascade?: boolean } & ObjectRef)
  | { op: 'grant_role'; role: string; member: string; admin_option?: boolean; inherit_option?: boolean; set_option?: boolean }
  | { op: 'revoke_role'; role: string; member: string; option_only?: 'admin' | 'inherit' | 'set' }
  | { op: 'alter_role'; role: string; attributes: RoleAttributes }
  | { op: 'create_role'; name: string; attributes?: RoleAttributes; member_of?: string[] }
  | { op: 'drop_role'; name: string; reassign_to?: string; drop_owned?: boolean }
  | { op: 'alter_role_config'; role: string; name: string; value?: string; database?: string }
  | { op: 'alter_system'; name: string; value?: string }
  | { op: 'reload_conf' }
  | { op: 'alter_database_config'; database: string; name: string; value?: string }
  | { op: 'create_extension'; name: string; schema?: string; version?: string; cascade?: boolean }
  | { op: 'update_extension'; name: string; version?: string }
  | { op: 'drop_extension'; name: string; cascade?: boolean }
  | { op: 'alter_owner'; kind: string; schema?: string; name: string; args?: string; new_owner: string }
  | { op: 'reassign_owned'; role: string; new_owner: string }
  | { op: 'cancel_backend'; pid: number }
  | { op: 'terminate_backend'; pid: number }
  | { op: 'vacuum'; schema: string; name: string; analyze?: boolean; full?: boolean }
  | { op: 'analyze'; schema: string; name: string }
  | { op: 'reset_statements' }
  | { op: 'drop_replication_slot'; name: string }
  | {
      op: 'alter_default'
      action: 'grant' | 'revoke'
      for_role?: string
      schema?: string
      object_type: DefaultKind
      grantee: string
      privileges: string[]
      grant_option?: boolean
    }

export type PendingChange = { id: string; database: string | null; label: string; change: Change }

export type Statement = { sql: string; description: string }
export type PlanResult = { statements: Statement[]; warnings: string[]; server_version_num: number; atomic: boolean }
export type ApplyResult = {
  ok: boolean
  executed: number
  error: string | null
  failed_index: number | null
  statements: Statement[]
}

export const PRIVILEGES: Record<ObjectKind | DefaultKind, string[]> = {
  database: ['CONNECT', 'CREATE', 'TEMPORARY'],
  schema: ['USAGE', 'CREATE'],
  table: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'],
  sequence: ['USAGE', 'SELECT', 'UPDATE'],
  function: ['EXECUTE'],
  tables: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'],
  sequences: ['USAGE', 'SELECT', 'UPDATE'],
  functions: ['EXECUTE'],
  types: ['USAGE'],
  schemas: ['USAGE', 'CREATE'],
}

/** Privileges valid for a kind on a given server version. */
export function privilegesFor(kind: ObjectKind | DefaultKind, version?: number): string[] {
  return PRIVILEGES[kind].filter((p) => p !== 'MAINTAIN' || (version ?? 0) >= 170000)
}

export function describeChange(c: Change): string {
  const target = (r: ObjectRef) =>
    r.all_in_schema
      ? `all ${r.kind}s in ${r.schema}`
      : r.kind === 'database' || r.kind === 'schema'
        ? `${r.kind} ${r.name}`
        : `${r.schema}.${r.name}${r.kind === 'function' ? `(${r.args ?? ''})` : ''}`
  switch (c.op) {
    case 'grant':
      return `GRANT ${c.privileges.join(', ')} ON ${target(c)} TO ${c.grantee}${c.grant_option ? ' (grant option)' : ''}`
    case 'revoke':
      return `REVOKE ${c.grant_option_only ? 'GRANT OPTION FOR ' : ''}${c.privileges.join(', ')} ON ${target(c)} FROM ${c.grantee}${c.cascade ? ' CASCADE' : ''}`
    case 'grant_role':
      return `GRANT ${c.role} TO ${c.member}`
    case 'revoke_role':
      return `REVOKE ${c.option_only ? `${c.option_only.toUpperCase()} OPTION FOR ` : ''}${c.role} FROM ${c.member}`
    case 'alter_role':
      return `ALTER ROLE ${c.role}`
    case 'create_role':
      return `CREATE ROLE ${c.name}`
    case 'drop_role':
      return `DROP ROLE ${c.name}`
    case 'alter_role_config':
      return c.value === undefined ? `RESET ${c.name} for ${c.role}` : `SET ${c.name} for ${c.role}`
    case 'alter_system':
      return c.value === undefined ? `ALTER SYSTEM RESET ${c.name}` : `ALTER SYSTEM SET ${c.name} = ${c.value}`
    case 'reload_conf':
      return 'Reload configuration (pg_reload_conf)'
    case 'alter_database_config':
      return c.value === undefined ? `RESET ${c.name} for database ${c.database}` : `SET ${c.name} for database ${c.database}`
    case 'create_extension':
      return `CREATE EXTENSION ${c.name}${c.schema ? ` SCHEMA ${c.schema}` : ''}${c.version ? ` VERSION ${c.version}` : ''}`
    case 'update_extension':
      return `ALTER EXTENSION ${c.name} UPDATE${c.version ? ` TO ${c.version}` : ''}`
    case 'drop_extension':
      return `DROP EXTENSION ${c.name}${c.cascade ? ' CASCADE' : ''}`
    case 'alter_owner':
      return `ALTER ${c.kind.toUpperCase()} ${c.schema ? `${c.schema}.` : ''}${c.name} OWNER TO ${c.new_owner}`
    case 'reassign_owned':
      return `REASSIGN OWNED BY ${c.role} TO ${c.new_owner}`
    case 'cancel_backend':
      return `Cancel query of backend ${c.pid}`
    case 'terminate_backend':
      return `Terminate backend ${c.pid}`
    case 'vacuum':
      return `VACUUM${c.full ? ' FULL' : ''}${c.analyze ? ' ANALYZE' : ''} ${c.schema}.${c.name}`
    case 'analyze':
      return `ANALYZE ${c.schema}.${c.name}`
    case 'reset_statements':
      return 'Reset pg_stat_statements'
    case 'drop_replication_slot':
      return `Drop replication slot ${c.name}`
    case 'alter_default':
      return `ALTER DEFAULT PRIVILEGES ${c.action.toUpperCase()} ${c.privileges.join(', ')} ON ${c.object_type.toUpperCase()} ${c.action === 'grant' ? 'TO' : 'FROM'} ${c.grantee}`
  }
}

type BasketValue = {
  items: PendingChange[]
  add: (change: Change, database: string | null) => void
  remove: (id: string) => void
  removeMany: (ids: string[]) => void
  clear: () => void
  open: boolean
  setOpen: (v: boolean) => void
}

const BasketContext = createContext<BasketValue | null>(null)

function storageKey(profileId: number | undefined) {
  return `pgcontrol.basket.${profileId ?? 'none'}`
}

export function BasketProvider({ children }: { children: ReactNode }) {
  const { current } = useInstance()
  const key = storageKey(current?.id)
  const [items, setItems] = useState<PendingChange[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key)
      setItems(raw ? (JSON.parse(raw) as PendingChange[]) : [])
    } catch {
      setItems([])
    }
  }, [key])

  const persist = useCallback(
    (next: PendingChange[]) => {
      setItems(next)
      try {
        sessionStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* ignore */
      }
    },
    [key],
  )

  const value = useMemo<BasketValue>(
    () => ({
      items,
      add: (change, database) =>
        persist([
          ...items,
          { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, database, label: describeChange(change), change },
        ]),
      remove: (id) => persist(items.filter((i) => i.id !== id)),
      removeMany: (ids) => persist(items.filter((i) => !ids.includes(i.id))),
      clear: () => persist([]),
      open,
      setOpen,
    }),
    [items, open, persist],
  )
  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>
}

export function useBasket(): BasketValue {
  const ctx = useContext(BasketContext)
  if (!ctx) throw new Error('useBasket outside BasketProvider')
  return ctx
}

/** Group pending changes by target database (role-level changes use the profile default). */
export function groupByDatabase(items: PendingChange[]): Array<{ database: string | null; items: PendingChange[] }> {
  const map = new Map<string | null, PendingChange[]>()
  for (const i of items) map.set(i.database, [...(map.get(i.database) ?? []), i])
  return [...map.entries()].map(([database, items]) => ({ database, items }))
}

export function usePlan(profileId: number) {
  return useMutation({
    mutationFn: (body: { database: string | null; operations: Change[] }) =>
      api.post<PlanResult>(`/api/profiles/${profileId}/plan`, body),
  })
}

export function useApply(profileId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { database: string | null; operations: Change[] }) =>
      api.post<ApplyResult>(`/api/profiles/${profileId}/apply`, body),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['profile', profileId] })
      qc.invalidateQueries({ queryKey: ['audit'] })
    },
  })
}
