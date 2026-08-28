import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { MinusCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DatabasePicker } from '../components/DatabasePicker'
import { GranteeSelect } from '../components/GranteeSelect'
import { NoInstance, QueryState } from '../components/QueryState'
import { Badge, Checkbox, EmptyRow, Input, PageHeader, Select, Table } from '../components/ui'
import { allGrantsQuery, schemasQuery, type FlatGrant } from '../lib/catalog'
import { useBasket, type ObjectKind } from '../lib/changes'
import { useDatabase, useInstance } from '../lib/instance'

const KIND_GROUP: Record<string, ObjectKind> = {
  database: 'database',
  schema: 'schema',
  table: 'table',
  view: 'table',
  'materialized view': 'table',
  'foreign table': 'table',
  'partitioned table': 'table',
  sequence: 'sequence',
  function: 'function',
  procedure: 'function',
  aggregate: 'function',
  'window function': 'function',
}

function objectLabel(g: FlatGrant) {
  const base = g.schema ? `${g.schema}.${g.name}` : g.name
  return g.args !== null && g.args !== undefined ? `${base}(${g.args})` : base
}

export function GrantsPage() {
  const { current } = useInstance()
  const { db, profileId } = useDatabase()
  const basket = useBasket()
  const grants = useQuery({ ...allGrantsQuery(profileId, db), enabled: !!current && !!db })
  const schemas = useQuery({ ...schemasQuery(profileId, db), enabled: !!current && !!db })
  const [grantee, setGrantee] = useState('')
  const [kind, setKind] = useState('')
  const [schema, setSchema] = useState('')
  const [search, setSearch] = useState('')
  const [explicitOnly, setExplicitOnly] = useState(false)
  const [hideOwner, setHideOwner] = useState(true)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (grants.data ?? []).filter(
      (g) =>
        (!grantee || g.grantee === grantee) &&
        (!kind || KIND_GROUP[g.kind] === kind) &&
        (!schema || g.schema === schema) &&
        (!explicitOnly || !g.acl_is_default) &&
        (!hideOwner || g.grantee !== g.owner) &&
        (!q || objectLabel(g).toLowerCase().includes(q) || g.grantee.toLowerCase().includes(q) || g.privilege.toLowerCase().includes(q)),
    )
  }, [grants.data, grantee, kind, schema, search, explicitOnly, hideOwner])

  const all = grants.data ?? []
  const publicCount = all.filter((g) => g.grantee === 'PUBLIC').length
  const grantableCount = all.filter((g) => g.grantable && g.grantee !== g.owner).length

  return (
    <>
      <PageHeader title="Grants" actions={<DatabasePicker />} />
      {!current ? (
        <NoInstance />
      ) : grants.isSuccess ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 text-sm">
            <Stat label="ACL entries" value={all.length} />
            <Stat label="Granted to PUBLIC" value={publicCount} tone={publicCount ? 'warn' : undefined} />
            <Stat label="With grant option" value={grantableCount} tone={grantableCount ? 'warn' : undefined} />
            <Stat label="Shown" value={rows.length} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-56">
              <GranteeSelect value={grantee} onChange={setGrantee} includeSystem placeholder="All grantees" />
            </div>
            <Select className="w-40" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All kinds</option>
              <option value="database">Database</option>
              <option value="schema">Schema</option>
              <option value="table">Tables & views</option>
              <option value="sequence">Sequences</option>
              <option value="function">Functions</option>
            </Select>
            <Select className="w-44" value={schema} onChange={(e) => setSchema(e.target.value)}>
              <option value="">All schemas</option>
              {(schemas.data ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Input className="w-56" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <span className="whitespace-nowrap">
              <Checkbox label="Explicit ACLs only" checked={explicitOnly} onChange={setExplicitOnly} />
            </span>
            <span className="whitespace-nowrap">
              <Checkbox label="Hide owner's own privileges" checked={hideOwner} onChange={setHideOwner} />
            </span>
          </div>
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Grantee</th>
                <th className="px-3 py-2">Privilege</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Object</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Grantor</th>
                <th className="px-3 py-2"></th>
              </tr>
            }
          >
            {rows.map((g, i) => (
              <tr key={i} className="hover:bg-ink-50">
                <td className="px-3 py-2 font-mono text-xs">
                  {g.grantee === 'PUBLIC' ? (
                    <Badge tone="warn">PUBLIC</Badge>
                  ) : (
                    <Link to="/roles/$name" params={{ name: g.grantee }} className="text-accent-700 hover:underline">
                      {g.grantee}
                    </Link>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {g.privilege}
                  {g.grantable && (
                    <span className="ml-1">
                      <Badge tone="warn">grant option</Badge>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-ink-600">{g.kind}</td>
                <td className="px-3 py-2 font-mono text-xs">{objectLabel(g)}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink-600">{g.owner}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink-600">{g.grantor}</td>
                <td className="px-3 py-2 text-right">
                  {g.grantee !== g.owner && (
                    <button
                      className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-ink-500 hover:text-red-700"
                      onClick={() =>
                        basket.add(
                          {
                            op: 'revoke',
                            kind: KIND_GROUP[g.kind],
                            schema: g.schema ?? undefined,
                            name: g.name,
                            args: g.args ?? undefined,
                            grantee: g.grantee,
                            privileges: [g.privilege],
                          },
                          KIND_GROUP[g.kind] === 'database' ? null : db,
                        )
                      }
                    >
                      <MinusCircle className="h-3.5 w-3.5" /> Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <EmptyRow colSpan={7}>No grants match.</EmptyRow>}
          </Table>
          <p className="text-xs text-ink-500">
            Default ACL entries (object has no explicit ACL) show the owner's implicit privileges and, for functions and databases, the built-in PUBLIC grants.
            Use "Explicit ACLs only" to see what was granted by hand.
          </p>
        </div>
      ) : (
        <QueryState query={grants} />
      )}
    </>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div className={`rounded-md border px-3 py-1.5 ${tone === 'warn' && value ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-ink-200 bg-white'}`}>
      <span className="text-xs uppercase tracking-wide text-ink-500">{label}</span> <span className="ml-1 font-semibold">{value}</span>
    </div>
  )
}
