import { queryOptions } from '@tanstack/react-query'
import { api } from './api'

export type RoleSummary = {
  oid: number
  name: string
  superuser: boolean
  inherit: boolean
  createrole: boolean
  createdb: boolean
  canlogin: boolean
  replication: boolean
  bypassrls: boolean
  connlimit: number
  valid_until: string | null
  expired: boolean
  config: string[]
  member_of: string[]
  members: string[]
  is_system: boolean
}

export type Membership = {
  role: string
  grantor: string | null
  admin_option: boolean
  inherit_option: boolean
  set_option: boolean
}

export type ClosureEntry = {
  oid: number
  name: string
  depth: number
  path: string[]
  inherited: boolean
}

export type RoleDetail = {
  role: RoleSummary
  member_of: Membership[]
  members: Membership[]
  inherits_from: ClosureEntry[]
  inherited_by: ClosureEntry[]
  extra: { server_version_num: number }
}

export type Source = {
  kind: 'acl' | 'owner' | 'superuser'
  grantee: string | null
  via: string[]
  grantor: string | null
  grant_option: boolean
}

export type Privilege = { name: string; granted: boolean; sources: Source[] }

export type ColumnGrant = { column: string; privilege: string; source: Source }

export type Policy = { name: string; command: string; permissive: boolean; roles: string[] }

export type ObjectPrivileges = {
  kind: string
  schema: string | null
  name: string
  owner: string
  is_owner: boolean
  privileges: Privilege[]
  blockers: string[]
  column_grants: ColumnGrant[]
  rls_enabled: boolean
  rls_forced: boolean
  policies: Policy[]
}

export type DefaultPrivilege = {
  for_role: string
  schema: string | null
  object_type: string
  privilege: string
  source: Source
}

export type EffectivePrivileges = {
  role: RoleSummary
  database: string
  server_version_num: number
  warnings: string[]
  membership: ClosureEntry[]
  database_privileges: ObjectPrivileges
  schemas: ObjectPrivileges[]
  objects: ObjectPrivileges[]
  default_privileges: DefaultPrivilege[]
}

export const databasesQuery = (profileId: number) =>
  queryOptions({
    queryKey: ['profile', profileId, 'databases'],
    queryFn: () => api.get<string[]>(`/api/profiles/${profileId}/databases`),
    staleTime: 60_000,
  })

export const rolesQuery = (profileId: number) =>
  queryOptions({
    queryKey: ['profile', profileId, 'roles'],
    queryFn: () => api.get<RoleSummary[]>(`/api/profiles/${profileId}/roles`),
    staleTime: 30_000,
  })

export const roleQuery = (profileId: number, name: string) =>
  queryOptions({
    queryKey: ['profile', profileId, 'roles', name],
    queryFn: () => api.get<RoleDetail>(`/api/profiles/${profileId}/roles/${encodeURIComponent(name)}`),
    staleTime: 30_000,
  })

export const effectiveQuery = (profileId: number, db: string, role: string, schema?: string) =>
  queryOptions({
    queryKey: ['profile', profileId, 'effective', db, role, schema ?? ''],
    queryFn: () => {
      const params = new URLSearchParams({ role })
      if (schema) params.set('schema', schema)
      return api.get<EffectivePrivileges>(
        `/api/profiles/${profileId}/databases/${encodeURIComponent(db)}/effective-privileges?${params}`,
      )
    },
    staleTime: 15_000,
  })

export function pgVersion(num: number): string {
  return `${Math.floor(num / 10000)}.${num % 100}`
}

export const schemasQuery = (profileId: number, db: string) =>
  queryOptions({
    queryKey: ['profile', profileId, 'databases', db, 'schemas'],
    queryFn: () =>
      api.get<string[]>(`/api/profiles/${profileId}/databases/${encodeURIComponent(db)}/schemas`),
    staleTime: 60_000,
  })
