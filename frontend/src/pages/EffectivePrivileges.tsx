import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { AlertTriangle, Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { NoInstance, QueryState } from '../components/QueryState'
import { RoleBadges } from '../components/RoleBadges'
import { Badge, Field, Input, PageHeader, Select } from '../components/ui'
import { cx } from '../lib/cx'
import {
  databasesQuery,
  effectiveQuery,
  pgVersion,
  rolesQuery,
  schemasQuery,
  type EffectivePrivileges,
  type ObjectPrivileges,
  type Privilege,
  type Source,
} from '../lib/catalog'
import { useInstance } from '../lib/instance'
import { Chain } from './RoleDetail'

export type EffectiveSearch = { db?: string; role?: string; schema?: string }

const KIND_LABEL: Record<string, string> = {
  database: 'database',
  schema: 'schema',
  table: 'table',
  view: 'view',
  'materialized view': 'mat. view',
  'foreign table': 'foreign table',
  'partitioned table': 'part. table',
  sequence: 'sequence',
  function: 'function',
  procedure: 'procedure',
  aggregate: 'aggregate',
  'window function': 'window fn',
}

const KIND_GROUPS: Record<string, string[]> = {
  tables: ['table', 'view', 'materialized view', 'foreign table', 'partitioned table'],
  sequences: ['sequence'],
  functions: ['function', 'procedure', 'aggregate', 'window function'],
}

function chain(role: string, via: string[]) {
  return [role, ...via]
}

function describeSource(s: Source, priv: string, role: string): ReactNode {
  const via = s.via.length ? (
    <>
      {' '}
      — inherited via <Chain path={chain(role, s.via)} />
    </>
  ) : null
  if (s.kind === 'superuser') return <>Superuser: privilege checks are bypassed</>
  if (s.kind === 'owner')
    return (
      <>
        Owner <span className="font-mono">{s.grantee}</span>
        {via}
      </>
    )
  return (
    <>
      GRANT {priv} TO <span className="font-mono">{s.grantee}</span>
      {s.grantor && (
        <>
          {' '}
          (by <span className="font-mono">{s.grantor}</span>)
        </>
      )}
      {s.grant_option && <span className="text-ink-500"> WITH GRANT OPTION</span>}
      {via}
    </>
  )
}

function PrivCell({ p, na }: { p?: Privilege; na?: boolean }) {
  if (na || !p) return <td className="px-2 py-1.5 text-center text-ink-300">–</td>
  return (
    <td className={cx('px-2 py-1.5 text-center', p.granted ? 'text-emerald-700' : 'text-red-600')}>
      {p.granted ? <Check className="inline h-4 w-4" /> : <X className="inline h-4 w-4" />}
    </td>
  )
}

function Why({ obj, role }: { obj: ObjectPrivileges; role: string }) {
  return (
    <div className="grid gap-4 text-sm lg:grid-cols-2">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Why</div>
        {obj.blockers.length > 0 && (
          <ul className="mb-2 space-y-1">
            {obj.blockers.map((b) => (
              <li key={b} className="flex items-center gap-1.5 text-red-700">
                <AlertTriangle className="h-3.5 w-3.5" /> {b}
              </li>
            ))}
          </ul>
        )}
        <ul className="space-y-1">
          {obj.privileges.map((p) => (
            <li key={p.name} className="flex gap-2">
              <span className={cx('w-24 shrink-0 font-mono text-xs leading-5', p.granted ? 'text-emerald-700' : 'text-red-600')}>
                {p.granted ? '✓' : '✗'} {p.name}
              </span>
              <span className="text-ink-700">
                {p.sources.length ? (
                  <ul className="space-y-0.5">
                    {p.sources.map((s, i) => (
                      <li key={i}>{describeSource(s, p.name, role)}</li>
                    ))}
                  </ul>
                ) : p.granted ? (
                  <span className="text-ink-500">granted (no explicit ACL entry found)</span>
                ) : (
                  <span className="text-ink-500">
                    no grant to <span className="font-mono">{role}</span>, PUBLIC or any inherited role
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-3">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Owner</div>
          <span className="font-mono">{obj.owner}</span>
          {obj.is_owner && <Badge tone="ok">role is owner</Badge>}
        </div>
        {obj.column_grants.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Column-level grants</div>
            <ul className="space-y-0.5">
              {obj.column_grants.map((c, i) => (
                <li key={i}>
                  <span className="font-mono">{c.column}</span>: {c.privilege}{' '}
                  <span className="text-ink-500">— {describeSource(c.source, c.privilege, role)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {obj.rls_enabled && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Row level security {obj.rls_forced && '(forced)'}</div>
            {obj.policies.length ? (
              <ul className="space-y-0.5">
                {obj.policies.map((p) => (
                  <li key={p.name}>
                    <span className="font-mono">{p.name}</span> — {p.command} {p.permissive ? 'permissive' : 'restrictive'}, for{' '}
                    <span className="font-mono">{p.roles.join(', ')}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-amber-700">
                RLS enabled but no policy applies to this role: all rows are hidden
                {obj.is_owner && !obj.rls_forced && ' (except for the owner)'}.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PrivTable({
  rows,
  privNames,
  role,
  label,
  showSchema,
}: {
  rows: ObjectPrivileges[]
  privNames: string[]
  role: string
  label: string
  showSchema?: boolean
}) {
  const [open, setOpen] = useState<string | null>(null)
  const key = (o: ObjectPrivileges) => `${o.kind}:${o.schema}:${o.name}`
  return (
    <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
          <tr>
            <th className="w-6 px-2 py-2"></th>
            <th className="px-2 py-2">{label}</th>
            {showSchema && <th className="px-2 py-2">Kind</th>}
            <th className="px-2 py-2">Owner</th>
            {privNames.map((p) => (
              <th key={p} className="px-2 py-2 text-center font-mono">
                {p}
              </th>
            ))}
            <th className="px-2 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((o) => {
            const k = key(o)
            const isOpen = open === k
            const byName = Object.fromEntries(o.privileges.map((p) => [p.name, p]))
            return (
              <Fragment key={k}>
                <tr className="cursor-pointer hover:bg-ink-50" onClick={() => setOpen(isOpen ? null : k)}>
                  <td className="px-2 py-1.5 text-ink-400">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                  <td className="px-2 py-1.5 font-mono">
                    {showSchema && <span className="text-ink-400">{o.schema}.</span>}
                    {o.name}
                  </td>
                  {showSchema && <td className="px-2 py-1.5 text-xs text-ink-500">{KIND_LABEL[o.kind] ?? o.kind}</td>}
                  <td className="px-2 py-1.5 font-mono text-xs text-ink-700">{o.owner}</td>
                  {privNames.map((p) => (
                    <PrivCell key={p} p={byName[p]} na={!(p in byName)} />
                  ))}
                  <td className="px-2 py-1.5">
                    <span className="inline-flex gap-1">
                      {o.blockers.length > 0 && <Badge tone="bad">blocked</Badge>}
                      {o.rls_enabled && <Badge tone="warn">RLS</Badge>}
                      {o.column_grants.length > 0 && <Badge>columns</Badge>}
                      {o.is_owner && <Badge tone="ok">owner</Badge>}
                    </span>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-ink-50/60">
                    <td></td>
                    <td colSpan={privNames.length + (showSchema ? 4 : 3)} className="px-2 py-3">
                      <Why obj={o} role={role} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={privNames.length + 5} className="px-3 py-6 text-center text-ink-500">
                Nothing to show.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Result({ data }: { data: EffectivePrivileges }) {
  const role = data.role.name
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<'all' | keyof typeof KIND_GROUPS>('all')
  const [deniedOnly, setDeniedOnly] = useState(false)

  const objectPrivs = useMemo(() => {
    const names: string[] = []
    for (const o of data.objects) for (const p of o.privileges) if (!names.includes(p.name)) names.push(p.name)
    return names
  }, [data.objects])

  const objects = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.objects.filter(
      (o) =>
        (kind === 'all' || KIND_GROUPS[kind].includes(o.kind)) &&
        (!q || `${o.schema}.${o.name}`.toLowerCase().includes(q)) &&
        (!deniedOnly || o.privileges.some((p) => !p.granted)),
    )
  }, [data.objects, search, kind, deniedOnly])

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-ink-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/roles/$name" params={{ name: role }} className="font-mono text-base font-semibold text-accent-700 hover:underline">
            {role}
          </Link>
          <RoleBadges role={data.role} compact />
          <span className="ml-auto text-xs text-ink-500">
            {data.database} · PostgreSQL {pgVersion(data.server_version_num)}
          </span>
        </div>
        {data.warnings.length > 0 && (
          <ul className="mt-3 space-y-1">
            {data.warnings.map((w) => (
              <li key={w} className="flex items-center gap-1.5 text-sm text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {w}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Membership chain</div>
          {data.membership.length ? (
            <ul className="flex flex-wrap gap-x-6 gap-y-1">
              {data.membership.map((m) => (
                <li key={m.oid} className="flex items-center gap-2">
                  <Chain path={m.path} />
                  {!m.inherited && <Badge tone="warn">not inherited</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-sm text-ink-500">No role memberships</span>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Database</h2>
        <PrivTable rows={[data.database_privileges]} privNames={data.database_privileges.privileges.map((p) => p.name)} role={role} label="Database" />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Schemas</h2>
        <PrivTable rows={data.schemas} privNames={['USAGE', 'CREATE']} role={role} label="Schema" />
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">
            Objects <span className="font-normal text-ink-500">({objects.length})</span>
          </h2>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-ink-700">
              <input type="checkbox" checked={deniedOnly} onChange={(e) => setDeniedOnly(e.target.checked)} />
              Denied only
            </label>
            <Select className="w-36" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="all">All kinds</option>
              <option value="tables">Tables & views</option>
              <option value="sequences">Sequences</option>
              <option value="functions">Functions</option>
            </Select>
            <Input className="w-56" placeholder="Filter objects…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <PrivTable rows={objects} privNames={objectPrivs} role={role} label="Object" showSchema />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Default privileges (future objects)</h2>
        <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-3 py-2">Objects created by</th>
                <th className="px-3 py-2">Schema</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Privilege</th>
                <th className="px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {data.default_privileges.map((d, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5 font-mono">{d.for_role}</td>
                  <td className="px-3 py-1.5 font-mono">{d.schema ?? <span className="text-ink-400">any</span>}</td>
                  <td className="px-3 py-1.5">{d.object_type}</td>
                  <td className="px-3 py-1.5 font-mono">{d.privilege}</td>
                  <td className="px-3 py-1.5 text-ink-700">{describeSource(d.source, d.privilege, role)}</td>
                </tr>
              ))}
              {data.default_privileges.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-ink-500">
                    No default privileges apply to this role.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export function EffectivePrivilegesPage() {
  const { current } = useInstance()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as EffectiveSearch
  const profileId = current?.id ?? 0

  const databases = useQuery({ ...databasesQuery(profileId), enabled: !!current })
  const roles = useQuery({ ...rolesQuery(profileId), enabled: !!current })

  const db = search.db && databases.data?.includes(search.db) ? search.db : (databases.data?.[0] ?? '')
  const role = search.role ?? ''
  const schema = search.schema ?? ''

  const schemas = useQuery({ ...schemasQuery(profileId, db), enabled: !!current && !!db })
  const result = useQuery({
    ...effectiveQuery(profileId, db, role, schema || undefined),
    enabled: !!current && !!db && !!role,
  })

  const update = (patch: EffectiveSearch) => navigate({ to: '/security/effective', search: { db, role, schema, ...patch } as EffectiveSearch, replace: true })

  return (
    <>
      <PageHeader title="Effective privileges" />
      {!current ? (
        <NoInstance />
      ) : (
        <>
          <div className="mb-5 grid gap-3 rounded-lg border border-ink-200 bg-white p-4 sm:grid-cols-3">
            <Field label="Database">
              <Select value={db} onChange={(e) => update({ db: e.target.value, schema: '' })}>
                {(databases.data ?? []).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Role">
              <Select value={role} onChange={(e) => update({ role: e.target.value })}>
                <option value="">Select a role…</option>
                {(roles.data ?? [])
                  .filter((r) => !r.is_system || r.name === role)
                  .map((r) => (
                    <option key={r.oid} value={r.name}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Schema">
              <Select value={schema} onChange={(e) => update({ schema: e.target.value })}>
                <option value="">All schemas</option>
                {(schemas.data ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {databases.isError ? (
            <QueryState query={databases} />
          ) : !role ? (
            <div className="rounded-md border border-dashed border-ink-300 p-8 text-center text-sm text-ink-500">
              Pick a role to see what it can actually access — and why.
            </div>
          ) : result.isSuccess ? (
            <Result data={result.data} />
          ) : (
            <QueryState query={result} />
          )}
        </>
      )}
    </>
  )
}
