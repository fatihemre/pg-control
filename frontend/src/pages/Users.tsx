import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Alert, Badge, Button, EmptyRow, Field, Input, Modal, PageHeader, Select, Table } from '../components/ui'
import { api, type User } from '../lib/api'
import { useMe } from '../lib/auth'
import { fmtTime } from '../lib/format'

type AdminUser = User & { subject: string | null; has_password: boolean; created_at: string }
type Role = User['role']
const ROLES: Role[] = ['viewer', 'operator', 'admin']

const usersQuery = { queryKey: ['users'], queryFn: () => api.get<AdminUser[]>('/api/users') }

export function UsersPage() {
  const me = useMe()
  const qc = useQueryClient()
  const users = useQuery({ ...usersQuery, enabled: me.data?.role === 'admin' })
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<AdminUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] })

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) => api.put<AdminUser>(`/api/users/${id}`, { role }),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (e) => setError(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.delete<void>(`/api/users/${id}`),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (e) => setError(e.message),
  })

  if (me.data && me.data.role !== 'admin') {
    return (
      <>
        <PageHeader title="Users" />
        <Alert tone="error">Only PgControl admins can manage accounts.</Alert>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Users"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add user
          </Button>
        }
      />
      <p className="mb-4 text-sm text-ink-600">
        PgControl accounts. <b>viewer</b> reads everything, <b>operator</b> can apply changes, <b>admin</b> also manages instances and users. Single sign-on
        accounts get their role from the identity provider when a role claim is configured.
      </p>
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {users.isError && <Alert tone="error">{users.error.message}</Alert>}
      <Table
        head={
          <tr>
            <th className="px-3 py-2">Username</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Sign-in</th>
            <th className="px-3 py-2">Created</th>
            <th className="px-3 py-2"></th>
          </tr>
        }
      >
        {(users.data ?? []).map((u) => {
          const self = u.id === me.data?.id
          return (
            <tr key={u.id} className="hover:bg-ink-50">
              <td className="px-3 py-2 font-mono">
                {u.username}
                {self && (
                  <span className="ml-2">
                    <Badge tone="neutral">you</Badge>
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                <Select value={u.role} onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value as Role })} disabled={setRole.isPending}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </td>
              <td className="px-3 py-2 text-xs">
                {u.auth_provider === 'oidc' ? (
                  <span title={u.subject ?? undefined}>
                    <Badge tone="ok">single sign-on</Badge>
                  </span>
                ) : (
                  <Badge tone="neutral">local password</Badge>
                )}
              </td>
              <td className="px-3 py-2 text-xs text-ink-500">{fmtTime(u.created_at)}</td>
              <td className="px-3 py-2 text-right">
                <span className="inline-flex gap-3 whitespace-nowrap">
                  {u.auth_provider === 'local' && !self && (
                    <button className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-accent-700" onClick={() => setResetting(u)}>
                      <KeyRound className="h-3.5 w-3.5" /> Reset password
                    </button>
                  )}
                  {!self && (
                    <button
                      className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-red-700"
                      onClick={() => {
                        if (confirm(`Delete user "${u.username}"?`)) remove.mutate(u.id)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  )}
                </span>
              </td>
            </tr>
          )
        })}
        {users.isSuccess && users.data.length === 0 && <EmptyRow colSpan={5}>No users.</EmptyRow>}
      </Table>
      {creating && (
        <CreateUser
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            invalidate()
          }}
        />
      )}
      {resetting && <ResetPassword user={resetting} onClose={() => setResetting(null)} />}
    </>
  )
}

function CreateUser({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const create = useMutation({
    mutationFn: () => api.post<AdminUser>('/api/users', { username, password, role }),
    onSuccess: onSaved,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate()
  }
  return (
    <Modal title="Add user" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Username" hint="Letters, digits, . _ @ -">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="off" />
        </Field>
        <Field label="Password" hint="At least 8 characters">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        {create.error && <Alert tone="error">{create.error.message}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || !username || password.length < 8}>
            Create user
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ResetPassword({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const reset = useMutation({
    mutationFn: () => api.put<AdminUser>(`/api/users/${user.id}`, { password }),
    onSuccess: onClose,
  })
  return (
    <Modal title={`Reset password · ${user.username}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          reset.mutate()
        }}
        className="space-y-4"
      >
        <p className="text-sm text-ink-600">The user's existing sessions are signed out.</p>
        <Field label="New password" hint="At least 8 characters">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="new-password" />
        </Field>
        {reset.error && <Alert tone="error">{reset.error.message}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={reset.isPending || password.length < 8}>
            Set password
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Self-service password change, opened from the sidebar. */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [done, setDone] = useState(false)
  const change = useMutation({
    mutationFn: () => api.post<void>('/api/users/me/password', { current_password: current, new_password: next }),
    onSuccess: () => setDone(true),
  })
  return (
    <Modal title="Change password" onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <Alert tone="ok">Password changed.</Alert>
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            change.mutate()
          }}
          className="space-y-4"
        >
          <Field label="Current password">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus autoComplete="current-password" />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" />
          </Field>
          {next && confirmPw && next !== confirmPw && <Alert tone="error">Passwords do not match.</Alert>}
          {change.error && <Alert tone="error">{change.error.message}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={change.isPending || next.length < 8 || next !== confirmPw || !current}>
              Change password
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
