import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { GranteeSelect } from '../components/GranteeSelect'
import { NoInstance, QueryState } from '../components/QueryState'
import { Alert, Button, Checkbox, EmptyRow, Field, Input, Modal, PageHeader, Table } from '../components/ui'
import { rolesQuery, type RoleSummary } from '../lib/catalog'
import { useBasket, type RoleAttributes } from '../lib/changes'
import { useInstance } from '../lib/instance'

type FlagKey = 'login' | 'superuser' | 'createdb' | 'createrole' | 'inherit' | 'replication' | 'bypassrls'
const FLAGS: Array<{ key: FlagKey; label: string; danger?: boolean }> = [
  { key: 'login', label: 'LOGIN' },
  { key: 'superuser', label: 'SUPERUSER', danger: true },
  { key: 'createdb', label: 'CREATEDB' },
  { key: 'createrole', label: 'CREATEROLE', danger: true },
  { key: 'inherit', label: 'INHERIT' },
  { key: 'replication', label: 'REPLICATION' },
  { key: 'bypassrls', label: 'BYPASSRLS', danger: true },
]

function flag(r: RoleSummary, key: FlagKey): boolean {
  return key === 'login' ? r.canlogin : r[key]
}

function Dot({ v }: { v: boolean }) {
  return <span className={v ? 'text-emerald-700' : 'text-ink-300'}>{v ? '●' : '○'}</span>
}

export function RoleAttributesPage() {
  const { current } = useInstance()
  const roles = useQuery({ ...rolesQuery(current?.id ?? 0), enabled: !!current })
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<RoleSummary | null>(null)
  const [creating, setCreating] = useState(false)
  const [dropping, setDropping] = useState<RoleSummary | null>(null)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (roles.data ?? []).filter((r) => !r.is_system && (!q || r.name.toLowerCase().includes(q)))
  }, [roles.data, search])

  return (
    <>
      <PageHeader
        title="Role attributes"
        actions={
          <div className="flex items-center gap-3">
            <Input className="w-56" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button className="whitespace-nowrap" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New role
            </Button>
          </div>
        }
      />
      {!current ? (
        <NoInstance />
      ) : roles.isSuccess ? (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Role</th>
              {FLAGS.map((f) => (
                <th key={f.key} className="px-2 py-2 text-center font-mono">
                  {f.label}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Conn. limit</th>
              <th className="px-3 py-2">Valid until</th>
              <th className="px-3 py-2"></th>
            </tr>
          }
        >
          {rows.map((r) => (
            <tr key={r.oid} className="hover:bg-ink-50">
              <td className="px-3 py-2 font-mono">
                <Link to="/roles/$name" params={{ name: r.name }} className="text-accent-700 hover:underline">
                  {r.name}
                </Link>
              </td>
              {FLAGS.map((f) => (
                <td key={f.key} className="px-2 py-2 text-center">
                  <Dot v={flag(r, f.key)} />
                </td>
              ))}
              <td className="px-3 py-2 text-right font-mono text-xs">{r.connlimit === -1 ? '∞' : r.connlimit}</td>
              <td className="px-3 py-2 font-mono text-xs">
                {r.valid_until ? r.valid_until.slice(0, 19).replace('T', ' ') : '—'}
                {r.expired && <span className="ml-1 text-red-600">expired</span>}
              </td>
              <td className="px-3 py-2 text-right">
                <span className="inline-flex gap-3">
                  <button className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-accent-700" onClick={() => setEditing(r)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-red-700" onClick={() => setDropping(r)}>
                    <Trash2 className="h-3.5 w-3.5" /> Drop
                  </button>
                </span>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow colSpan={FLAGS.length + 4}>No roles.</EmptyRow>}
        </Table>
      ) : (
        <QueryState query={roles} />
      )}
      {editing && <RoleForm role={editing} onClose={() => setEditing(null)} />}
      {creating && <RoleForm onClose={() => setCreating(false)} />}
      {dropping && <DropRole role={dropping} onClose={() => setDropping(null)} />}
    </>
  )
}

function RoleForm({ role, onClose }: { role?: RoleSummary; onClose: () => void }) {
  const basket = useBasket()
  const { current } = useInstance()
  const roles = useQuery({ ...rolesQuery(current?.id ?? 0), enabled: !!current })
  const [name, setName] = useState(role?.name ?? '')
  const [flags, setFlags] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(FLAGS.map((f) => [f.key, role ? flag(role, f.key) : f.key === 'inherit'])),
  )
  const [connlimit, setConnlimit] = useState(String(role?.connlimit ?? -1))
  const [validUntil, setValidUntil] = useState(role?.valid_until ? role.valid_until.slice(0, 19) : '')
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [memberOf, setMemberOf] = useState<Set<string>>(new Set())

  const submit = () => {
    const attrs: RoleAttributes = {}
    for (const f of FLAGS) {
      const v = flags[f.key]
      if (!role || flag(role, f.key) !== v) attrs[f.key] = v
    }
    const limit = Number(connlimit)
    if (!Number.isNaN(limit) && (!role || role.connlimit !== limit) && (role || limit !== -1)) attrs.connlimit = limit
    const original = role?.valid_until ? role.valid_until.slice(0, 19) : ''
    if (validUntil !== original) attrs.valid_until = validUntil
    if (clearPassword) attrs.password = ''
    else if (password) attrs.password = password
    if (role) {
      if (Object.keys(attrs).length) basket.add({ op: 'alter_role', role: role.name, attributes: attrs }, null)
    } else {
      if (!name.trim()) return
      basket.add({ op: 'create_role', name: name.trim(), attributes: attrs, member_of: [...memberOf] }, null)
    }
    onClose()
  }

  return (
    <Modal title={role ? `Edit role · ${role.name}` : 'New role'} onClose={onClose}>
      <div className="space-y-4">
        {!role && (
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {FLAGS.map((f) => (
            <Checkbox
              key={f.key}
              label={<span className={f.danger ? 'font-mono text-amber-800' : 'font-mono'}>{f.label}</span>}
              checked={flags[f.key]}
              onChange={(v) => setFlags({ ...flags, [f.key]: v })}
            />
          ))}
        </div>
        {flags.superuser && <Alert tone="error">SUPERUSER bypasses every permission check.</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Connection limit" hint="-1 = unlimited">
            <Input type="number" min={-1} value={connlimit} onChange={(e) => setConnlimit(e.target.value)} />
          </Field>
          <Field label="Valid until" hint="Empty = never expires">
            <Input type="datetime-local" step={1} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
        </div>
        <Field label={role ? 'New password' : 'Password'} hint={role ? 'Leave empty to keep the current password' : undefined}>
          <Input type="password" autoComplete="new-password" value={password} disabled={clearPassword} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {role && <Checkbox label="Remove password (PASSWORD NULL)" checked={clearPassword} onChange={setClearPassword} />}
        {!role && (
          <Field label="Member of">
            <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-ink-200 p-2">
              {(roles.data ?? [])
                .filter((r) => !r.is_system)
                .map((r) => (
                  <Checkbox
                    key={r.oid}
                    label={<span className="font-mono text-xs">{r.name}</span>}
                    checked={memberOf.has(r.name)}
                    onChange={(v) => {
                      const next = new Set(memberOf)
                      if (v) next.add(r.name)
                      else next.delete(r.name)
                      setMemberOf(next)
                    }}
                  />
                ))}
            </div>
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!role && !name.trim()}>
            Add to pending changes
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function DropRole({ role, onClose }: { role: RoleSummary; onClose: () => void }) {
  const basket = useBasket()
  const [reassign, setReassign] = useState('')
  const [dropOwned, setDropOwned] = useState(false)
  return (
    <Modal title={`Drop role · ${role.name}`} onClose={onClose}>
      <div className="space-y-4">
        <Alert tone="error">
          DROP ROLE fails while the role still owns objects or holds privileges. Reassign ownership first, or drop what it owns.
        </Alert>
        <Field label="Reassign owned objects to" hint="Runs REASSIGN OWNED BY … TO … then DROP OWNED BY … (current database only)">
          <GranteeSelect value={reassign} onChange={setReassign} allowPublic={false} exclude={[role.name]} placeholder="Do not reassign" />
        </Field>
        <Checkbox label="DROP OWNED BY (drop remaining objects and revoke privileges in the current database)" checked={dropOwned || !!reassign} onChange={setDropOwned} disabled={!!reassign} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              basket.add({ op: 'drop_role', name: role.name, reassign_to: reassign || undefined, drop_owned: dropOwned || undefined }, null)
              onClose()
            }}
          >
            Add DROP ROLE to pending changes
          </Button>
        </div>
      </div>
    </Modal>
  )
}
