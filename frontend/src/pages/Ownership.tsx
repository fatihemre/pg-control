import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRightLeft, UserCog } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DatabasePicker } from '../components/DatabasePicker'
import { GranteeSelect } from '../components/GranteeSelect'
import { NoInstance, QueryState } from '../components/QueryState'
import { Alert, Badge, Button, EmptyRow, Field, Input, Modal, PageHeader, Select, Table, cx } from '../components/ui'
import { ownershipQuery, rolesQuery, type OwnedObject, type RoleSummary } from '../lib/catalog'
import { useBasket } from '../lib/changes'
import { useDatabase, useInstance } from '../lib/instance'

const KIND_ORDER = ['database', 'schema', 'table', 'partitioned table', 'view', 'materialized view', 'foreign table', 'sequence', 'function', 'procedure', 'aggregate', 'window function']

function objectLabel(o: OwnedObject) {
  const base = o.schema ? `${o.schema}.${o.name}` : o.name
  return o.args !== null && o.args !== undefined ? `${base}(${o.args})` : base
}

export function OwnershipPage() {
  const { current } = useInstance()
  const { db, profileId } = useDatabase()
  const objects = useQuery({ ...ownershipQuery(profileId, db), enabled: !!current && !!db })
  const roles = useQuery({ ...rolesQuery(profileId), enabled: !!current })
  const [owner, setOwner] = useState('')
  const [kind, setKind] = useState('')
  const [search, setSearch] = useState('')
  const [changing, setChanging] = useState<OwnedObject | null>(null)
  const [reassigning, setReassigning] = useState<string | null>(null)

  const roleMap = useMemo(() => new Map((roles.data ?? []).map((r) => [r.name, r])), [roles.data])

  const owners = useMemo(() => {
    const map = new Map<string, Record<string, number>>()
    for (const o of objects.data ?? []) {
      const counts = map.get(o.owner) ?? {}
      counts[o.kind] = (counts[o.kind] ?? 0) + 1
      map.set(o.owner, counts)
    }
    return [...map.entries()]
      .map(([name, counts]) => ({ name, counts, total: Object.values(counts).reduce((a, b) => a + b, 0), role: roleMap.get(name) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  }, [objects.data, roleMap])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (objects.data ?? [])
      .filter((o) => (!owner || o.owner === owner) && (!kind || o.kind === kind) && (!q || objectLabel(o).toLowerCase().includes(q)))
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || objectLabel(a).localeCompare(objectLabel(b)))
  }, [objects.data, owner, kind, search])

  const kinds = useMemo(
    () => [...new Set((objects.data ?? []).map((o) => o.kind))].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b)),
    [objects.data],
  )
  const loginOwners = owners.filter((o) => o.role && o.role.canlogin && !o.role.superuser)

  return (
    <>
      <PageHeader title="Ownership" actions={<DatabasePicker />} />
      {!current ? (
        <NoInstance />
      ) : objects.isSuccess ? (
        <div className="space-y-5">
          {loginOwners.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {loginOwners.map((o) => o.name).join(', ')} {loginOwners.length === 1 ? 'is a login user that owns' : 'are login users that own'} objects. Prefer a
              NOLOGIN group role as owner so people can come and go without REASSIGN OWNED.
            </div>
          )}
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Objects</th>
                <th className="px-3 py-2">By kind</th>
                <th className="px-3 py-2"></th>
              </tr>
            }
          >
            {owners.map((o) => (
              <tr
                key={o.name}
                className={cx('cursor-pointer hover:bg-ink-50', owner === o.name && 'bg-accent-50')}
                onClick={() => setOwner(owner === o.name ? '' : o.name)}
              >
                <td className="px-3 py-2 font-mono">
                  <Link to="/roles/$name" params={{ name: o.name }} className="text-accent-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                    {o.name}
                  </Link>
                  <span className="ml-2 inline-flex gap-1">
                    {o.role?.superuser && <Badge tone="warn">superuser</Badge>}
                    {o.role && o.role.canlogin && !o.role.superuser && <Badge tone="warn">login user</Badge>}
                    {o.role && !o.role.canlogin && <Badge>group role</Badge>}
                  </span>
                </td>
                <td className="px-3 py-2">{o.total}</td>
                <td className="px-3 py-2 text-xs text-ink-600">
                  {Object.entries(o.counts)
                    .sort((a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]))
                    .map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`)
                    .join(', ')}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-ink-500 hover:text-accent-700"
                    onClick={(e) => {
                      e.stopPropagation()
                      setReassigning(o.name)
                    }}
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" /> Reassign all
                  </button>
                </td>
              </tr>
            ))}
            {owners.length === 0 && <EmptyRow colSpan={4}>No objects.</EmptyRow>}
          </Table>

          <div className="flex items-center gap-3">
            <Select className="w-48" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">All owners</option>
              {owners.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.name}
                </option>
              ))}
            </Select>
            <Select className="w-48" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All kinds</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
            <Input className="w-64" placeholder="Filter objects…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <span className="text-xs text-ink-500">{rows.length} objects</span>
          </div>
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Object</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2"></th>
              </tr>
            }
          >
            {rows.map((o) => (
              <tr key={`${o.kind}:${objectLabel(o)}`} className="hover:bg-ink-50">
                <td className="px-3 py-2 text-xs text-ink-600">{o.kind}</td>
                <td className="px-3 py-2 font-mono text-xs">{objectLabel(o)}</td>
                <td className="px-3 py-2 font-mono text-xs">{o.owner}</td>
                <td className="px-3 py-2 text-right">
                  <button className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-ink-500 hover:text-accent-700" onClick={() => setChanging(o)}>
                    <UserCog className="h-3.5 w-3.5" /> Change owner
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <EmptyRow colSpan={4}>No objects match.</EmptyRow>}
          </Table>
        </div>
      ) : (
        <QueryState query={objects} />
      )}
      {changing && <ChangeOwner obj={changing} database={db} roleMap={roleMap} onClose={() => setChanging(null)} />}
      {reassigning && <ReassignOwned role={reassigning} database={db} onClose={() => setReassigning(null)} />}
    </>
  )
}

function ChangeOwner({ obj, database, roleMap, onClose }: { obj: OwnedObject; database: string; roleMap: Map<string, RoleSummary>; onClose: () => void }) {
  const basket = useBasket()
  const [to, setTo] = useState('')
  const target = roleMap.get(to)
  return (
    <Modal title={`Change owner · ${objectLabel(obj)}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="New owner">
          <GranteeSelect value={to} onChange={setTo} allowPublic={false} exclude={[obj.owner]} />
        </Field>
        {target && target.canlogin && !target.superuser && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{to} is a login user; consider a NOLOGIN group role instead.</div>
        )}
        <p className="text-xs text-ink-500">The connected role must be a member of the new owner (or a superuser). Privileges granted to other roles are kept.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!to}
            onClick={() => {
              basket.add(
                { op: 'alter_owner', kind: obj.kind, schema: obj.schema ?? undefined, name: obj.name, args: obj.args ?? undefined, new_owner: to },
                obj.kind === 'database' ? null : database,
              )
              onClose()
            }}
          >
            Add to pending changes
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ReassignOwned({ role, database, onClose }: { role: string; database: string; onClose: () => void }) {
  const basket = useBasket()
  const [to, setTo] = useState('')
  return (
    <Modal title={`Reassign everything owned by ${role}`} onClose={onClose}>
      <div className="space-y-4">
        <Alert tone="error">
          REASSIGN OWNED moves every object {role} owns in database {database} (plus shared objects such as databases) to the new owner. Other databases are
          not touched.
        </Alert>
        <Field label="New owner">
          <GranteeSelect value={to} onChange={setTo} allowPublic={false} exclude={[role]} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!to}
            onClick={() => {
              basket.add({ op: 'reassign_owned', role, new_owner: to }, database)
              onClose()
            }}
          >
            Add REASSIGN OWNED to pending changes
          </Button>
        </div>
      </div>
    </Modal>
  )
}
