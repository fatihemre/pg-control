import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { GranteeSelect } from '../components/GranteeSelect'
import { NoInstance, QueryState } from '../components/QueryState'
import { Button, Checkbox, EmptyRow, Field, Input, Modal, PageHeader, Select, Table } from '../components/ui'
import { membershipsQuery, serverQuery } from '../lib/catalog'
import { useBasket } from '../lib/changes'
import { useInstance } from '../lib/instance'

function Flag({ v }: { v: boolean }) {
  return v ? <span className="text-emerald-700">yes</span> : <span className="text-ink-400">no</span>
}

export function MembershipsPage() {
  const { current } = useInstance()
  const basket = useBasket()
  const profileId = current?.id ?? 0
  const memberships = useQuery({ ...membershipsQuery(profileId), enabled: !!current })
  const server = useQuery({ ...serverQuery(profileId), enabled: !!current })
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const pg16 = (server.data?.server_version_num ?? 0) >= 160000

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (memberships.data ?? []).filter((m) => !q || m.role.toLowerCase().includes(q) || m.member.toLowerCase().includes(q))
  }, [memberships.data, search])

  return (
    <>
      <PageHeader
        title="Memberships"
        actions={
          <div className="flex items-center gap-3">
            <Input className="w-56" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button className="whitespace-nowrap" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add membership
            </Button>
          </div>
        }
      />
      {!current ? (
        <NoInstance />
      ) : memberships.isSuccess ? (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Member</th>
              <th className="px-3 py-2">Granted by</th>
              <th className="px-3 py-2">Admin</th>
              <th className="px-3 py-2">Inherit</th>
              <th className="px-3 py-2">Set</th>
              <th className="px-3 py-2"></th>
            </tr>
          }
        >
          {rows.map((m) => (
            <tr key={`${m.role}/${m.member}`} className="hover:bg-ink-50">
              <td className="px-3 py-2 font-mono">
                <Link to="/roles/$name" params={{ name: m.role }} className="text-accent-700 hover:underline">
                  {m.role}
                </Link>
              </td>
              <td className="px-3 py-2 font-mono">
                <Link to="/roles/$name" params={{ name: m.member }} className="text-accent-700 hover:underline">
                  {m.member}
                </Link>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-ink-600">{m.grantor ?? '—'}</td>
              <td className="px-3 py-2">
                <Flag v={m.admin_option} />
              </td>
              <td className="px-3 py-2">
                <Flag v={m.inherit_option} />
              </td>
              <td className="px-3 py-2">
                <Flag v={m.set_option} />
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-red-700"
                  onClick={() => basket.add({ op: 'revoke_role', role: m.role, member: m.member }, null)}
                >
                  <X className="h-3.5 w-3.5" /> Revoke
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow colSpan={7}>No memberships.</EmptyRow>}
        </Table>
      ) : (
        <QueryState query={memberships} />
      )}
      {adding && <AddMembership pg16={pg16} onClose={() => setAdding(false)} />}
    </>
  )
}

type Tri = '' | 'true' | 'false'

function AddMembership({ pg16, onClose }: { pg16: boolean; onClose: () => void }) {
  const basket = useBasket()
  const [role, setRole] = useState('')
  const [member, setMember] = useState('')
  const [admin, setAdmin] = useState(false)
  const [inherit, setInherit] = useState<Tri>('')
  const [set, setSet] = useState<Tri>('')
  const tri = (v: Tri) => (v === '' ? undefined : v === 'true')

  const submit = () => {
    if (!role || !member || role === member) return
    basket.add(
      { op: 'grant_role', role, member, admin_option: admin || undefined, inherit_option: tri(inherit), set_option: tri(set) },
      null,
    )
    onClose()
  }

  return (
    <Modal title="Add membership" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Role (privileges to inherit)">
          <GranteeSelect value={role} onChange={setRole} allowPublic={false} includeSystem />
        </Field>
        <Field label="Member (who receives them)">
          <GranteeSelect value={member} onChange={setMember} allowPublic={false} exclude={role ? [role] : []} />
        </Field>
        <Checkbox label="ADMIN OPTION (member may grant this role to others)" checked={admin} onChange={setAdmin} />
        {pg16 && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="INHERIT" hint="Default: the member's INHERIT attribute">
              <Select value={inherit} onChange={(e) => setInherit(e.target.value as Tri)}>
                <option value="">Default</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </Select>
            </Field>
            <Field label="SET" hint="Whether the member may SET ROLE to it">
              <Select value={set} onChange={(e) => setSet(e.target.value as Tri)}>
                <option value="">Default (true)</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </Select>
            </Field>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!role || !member || role === member}>
            Add to pending changes
          </Button>
        </div>
      </div>
    </Modal>
  )
}
