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

export type ServerInfo = {
  server_version_num: number
  version: string
  current_user: string
  in_recovery: boolean
  is_superuser: boolean
}

export const serverQuery = (profileId: number) =>
  queryOptions({
    queryKey: ['profile', profileId, 'server'],
    queryFn: () => api.get<ServerInfo>(`/api/profiles/${profileId}/server`),
    staleTime: 5 * 60_000,
  })

export type MembershipRow = {
  role: string
  member: string
  grantor: string | null
  admin_option: boolean
  inherit_option: boolean
  set_option: boolean
}

export const membershipsQuery = (profileId: number) =>
  queryOptions({
    queryKey: ['profile', profileId, 'memberships'],
    queryFn: () => api.get<MembershipRow[]>(`/api/profiles/${profileId}/memberships`),
    staleTime: 30_000,
  })

export type Grant = { grantee: string; privilege: string; grantable: boolean; grantor: string }
export type ObjectGrants = {
  kind: string
  schema: string | null
  name: string
  args: string | null
  owner: string
  acl_is_default: boolean
  grants: Grant[]
}

export const grantsQuery = (profileId: number, db: string, kind: string, schema?: string) =>
  queryOptions({
    queryKey: ['profile', profileId, 'grants', db, kind, schema ?? ''],
    queryFn: () => {
      const params = new URLSearchParams({ kind })
      if (schema) params.set('schema', schema)
      return api.get<ObjectGrants[]>(`/api/profiles/${profileId}/databases/${encodeURIComponent(db)}/grants?${params}`)
    },
    staleTime: 15_000,
  })

export type AuditEntry = {
  id: number
  created_at: string
  user: string | null
  profile_id: number | null
  profile: string | null
  action: string
  detail: {
    database?: string
    statements?: string[]
    descriptions?: string[]
    executed?: number
    error?: string | null
    failed_index?: number | null
  } | null
}

export const auditQuery = (profileId?: number) =>
  queryOptions({
    queryKey: ['audit', profileId ?? 'all'],
    queryFn: () => api.get<AuditEntry[]>(`/api/audit?limit=200${profileId ? `&profile_id=${profileId}` : ''}`),
    staleTime: 10_000,
  })

export type Setting = {
  name: string
  setting: string | null
  unit: string | null
  category: string
  short_desc: string
  extra_desc: string | null
  context: 'internal' | 'postmaster' | 'sighup' | 'superuser-backend' | 'backend' | 'superuser' | 'user'
  vartype: 'bool' | 'integer' | 'real' | 'string' | 'enum'
  source: string
  min_val: string | null
  max_val: string | null
  enumvals: string[] | null
  boot_val: string | null
  reset_val: string | null
  sourcefile: string | null
  sourceline: number | null
  pending_restart: boolean
  is_default: boolean
}

export const settingsQuery = (profileId: number) =>
  queryOptions({
    queryKey: ['profile', profileId, 'settings'],
    queryFn: () => api.get<Setting[]>(`/api/profiles/${profileId}/settings`),
  })

export type FileSetting = {
  sourcefile: string
  sourceline: number
  seqno: number
  name: string
  setting: string | null
  applied: boolean
  error: string | null
}

export const fileSettingsQuery = (profileId: number) =>
  queryOptions({
    queryKey: ['profile', profileId, 'file-settings'],
    queryFn: () => api.get<{ readable: boolean; rows: FileSetting[] }>(`/api/profiles/${profileId}/file-settings`),
  })

export type HbaRule = {
  rule_number: number | null
  file_name: string | null
  line_number: number | null
  type: string | null
  database: string[] | null
  user_name: string[] | null
  address: string | null
  netmask: string | null
  auth_method: string | null
  options: string[] | null
  error: string | null
}

export const hbaQuery = (profileId: number) =>
  queryOptions({
    queryKey: ['profile', profileId, 'hba'],
    queryFn: () => api.get<{ readable: boolean; rows: HbaRule[] }>(`/api/profiles/${profileId}/hba`),
  })

export type RoleDbSetting = { role: string | null; database: string | null; name: string; value: string }

export const roleDbSettingsQuery = (profileId: number) =>
  queryOptions({
    queryKey: ['profile', profileId, 'role-db-settings'],
    queryFn: () => api.get<RoleDbSetting[]>(`/api/profiles/${profileId}/role-db-settings`),
  })

export type Extension = {
  name: string
  default_version: string | null
  installed_version: string | null
  comment: string | null
  schema: string | null
  relocatable: boolean | null
  superuser_required: boolean | null
  trusted: boolean | null
  versions: string[]
  update_available: boolean
}

export const extensionsQuery = (profileId: number, db: string) =>
  queryOptions({
    queryKey: ['profile', profileId, 'db', db, 'extensions'],
    queryFn: () => api.get<Extension[]>(`/api/profiles/${profileId}/databases/${encodeURIComponent(db)}/extensions`),
  })
