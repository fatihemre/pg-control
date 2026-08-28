import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Plug, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Alert, Badge, Button, Field, Input, Modal, PageHeader, Select } from '../components/ui'
import { api, type Profile, type ProfileInput, type ServerInfo, type SslMode } from '../lib/api'
import { useMe } from '../lib/auth'

const SSL_MODES: SslMode[] = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']

const EMPTY: ProfileInput = {
  name: '',
  host: '',
  port: 5432,
  database: 'postgres',
  username: '',
  password: '',
  sslmode: 'prefer',
  sslrootcert: '',
  connect_timeout: 10,
  read_only: false,
  patroni_url: '',
  patroni_username: '',
  patroni_password: '',
}

export function ConnectionsPage() {
  const me = useMe()
  const qc = useQueryClient()
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => api.get<Profile[]>('/api/profiles') })
  const [editing, setEditing] = useState<Profile | 'new' | null>(null)
  const [testResult, setTestResult] = useState<Record<number, ServerInfo | Error>>({})
  const isAdmin = me.data?.role === 'admin'

  const test = useMutation({
    mutationFn: (id: number) => api.post<ServerInfo>(`/api/profiles/${id}/test`),
    onSuccess: (info, id) => setTestResult((r) => ({ ...r, [id]: info })),
    onError: (err, id) => setTestResult((r) => ({ ...r, [id]: err })),
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.delete<void>(`/api/profiles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  })

  return (
    <div>
      <PageHeader
        title="PostgreSQL instances"
        actions={
          isAdmin && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> Add instance
            </Button>
          )
        }
      />

      {profiles.isLoading && <p className="text-sm text-ink-500">Loading…</p>}
      {profiles.data?.length === 0 && (
        <div className="rounded-lg border border-dashed border-ink-300 p-10 text-center text-sm text-ink-500">
          No instances yet. Add a connection profile to get started.
        </div>
      )}

      <div className="space-y-3">
        {profiles.data?.map((p) => {
          const result = testResult[p.id]
          return (
            <div key={p.id} className="rounded-lg border border-ink-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    {p.read_only && <Badge tone="warn">read-only</Badge>}
                    {p.patroni_url && <Badge tone="ok">Patroni</Badge>}
                    {!p.has_password && <Badge tone="neutral">no stored password</Badge>}
                  </div>
                  <div className="mt-1 font-mono text-xs text-ink-500">
                    {p.username}@{p.host}:{p.port}/{p.database} · sslmode={p.sslmode}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button variant="secondary" onClick={() => test.mutate(p.id)} disabled={test.isPending}>
                    <Plug className="h-4 w-4" /> Test
                  </Button>
                  {isAdmin && (
                    <>
                      <Button variant="secondary" onClick={() => setEditing(p)} aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="danger"
                        aria-label="Delete"
                        onClick={() => {
                          if (confirm(`Delete profile "${p.name}"?`)) remove.mutate(p.id)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {result && (
                <div className="mt-3">
                  <TestResult result={result} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {editing && (
        <ProfileForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            qc.invalidateQueries({ queryKey: ['profiles'] })
          }}
        />
      )}
    </div>
  )
}

function TestResult({ result }: { result: ServerInfo | Error }) {
  if (result instanceof Error) return <Alert tone="error">{result.message}</Alert>
  return (
    <Alert tone="ok">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{result.version.split(' on ')[0]}</span>
        <Badge tone={result.is_superuser ? 'warn' : 'ok'}>
          {result.current_user}
          {result.is_superuser ? ' · superuser' : ''}
        </Badge>
        {result.in_recovery && <Badge tone="neutral">standby</Badge>}
      </div>
      <div className="mt-1 text-xs">
        {result.databases.length} database{result.databases.length === 1 ? '' : 's'}: <span className="font-mono">{result.databases.join(', ')}</span>
      </div>
    </Alert>
  )
}

function ProfileForm({ initial, onClose, onSaved }: { initial: Profile | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ProfileInput>(
    initial
      ? {
          ...initial,
          password: '',
          sslrootcert: initial.sslrootcert ?? '',
          patroni_url: initial.patroni_url ?? '',
          patroni_username: initial.patroni_username ?? '',
          patroni_password: '',
        }
      : EMPTY,
  )
  const [keepPassword, setKeepPassword] = useState(initial?.has_password ?? false)
  const [keepPatroniPassword, setKeepPatroniPassword] = useState(initial?.has_patroni_password ?? false)
  const [showPatroni, setShowPatroni] = useState(!!initial?.patroni_url)
  const [testResult, setTestResult] = useState<ServerInfo | Error | null>(null)

  function set<K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function payload(): ProfileInput {
    const password = initial && keepPassword ? null : form.password || ''
    const patroni_password = initial && keepPatroniPassword ? null : form.patroni_password || ''
    return {
      ...form,
      password,
      sslrootcert: form.sslrootcert || null,
      patroni_url: showPatroni ? form.patroni_url || null : null,
      patroni_username: showPatroni ? form.patroni_username || null : null,
      patroni_password: showPatroni ? patroni_password : '',
    }
  }

  const save = useMutation({
    mutationFn: () =>
      initial
        ? api.put<Profile>(`/api/profiles/${initial.id}`, payload())
        : api.post<Profile>('/api/profiles', { ...payload(), password: form.password || null }),
    onSuccess: onSaved,
  })

  const test = useMutation({
    mutationFn: () =>
      initial && keepPassword
        ? api.post<ServerInfo>(`/api/profiles/${initial.id}/test`)
        : api.post<ServerInfo>('/api/profiles/test', { ...form, sslrootcert: form.sslrootcert || null }),
    onSuccess: setTestResult,
    onError: setTestResult,
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate()
  }

  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'Add instance'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Host">
              <Input value={form.host} onChange={(e) => set('host', e.target.value)} required />
            </Field>
          </div>
          <Field label="Port">
            <Input type="number" min={1} max={65535} value={form.port} onChange={(e) => set('port', Number(e.target.value))} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username">
            <Input value={form.username} onChange={(e) => set('username', e.target.value)} required />
          </Field>
          <Field label="Maintenance database">
            <Input value={form.database} onChange={(e) => set('database', e.target.value)} required />
          </Field>
        </div>
        <Field
          label="Password"
          hint={
            initial?.has_password && keepPassword
              ? 'A password is stored (encrypted). Enter a new one to replace it.'
              : 'Leave empty to rely on .pgpass / trust / peer authentication.'
          }
        >
          <Input
            type="password"
            value={form.password ?? ''}
            placeholder={initial?.has_password && keepPassword ? '••••••••' : ''}
            autoComplete="new-password"
            onChange={(e) => {
              set('password', e.target.value)
              setKeepPassword(false)
            }}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="SSL mode">
            <Select value={form.sslmode} onChange={(e) => set('sslmode', e.target.value as SslMode)}>
              {SSL_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <div className="col-span-2">
            <Field label="SSL root cert (path)">
              <Input value={form.sslrootcert ?? ''} onChange={(e) => set('sslrootcert', e.target.value)} />
            </Field>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Connect timeout (s)">
            <Input type="number" min={1} max={120} value={form.connect_timeout} onChange={(e) => set('connect_timeout', Number(e.target.value))} />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={form.read_only} onChange={(e) => set('read_only', e.target.checked)} className="h-4 w-4 accent-accent-600" />
            Read-only (disable all write actions)
          </label>
        </div>

        <div className="rounded-md border border-ink-200 bg-ink-50/50 p-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showPatroni} onChange={(e) => setShowPatroni(e.target.checked)} className="h-4 w-4 accent-accent-600" />
            Managed by Patroni
          </label>
          {showPatroni && (
            <div className="mt-3 space-y-3">
              <Field label="Patroni REST API URL" hint="Any member's REST endpoint, e.g. http://patroni1:8008. Used for the Cluster → Patroni page.">
                <Input
                  value={form.patroni_url ?? ''}
                  onChange={(e) => set('patroni_url', e.target.value)}
                  placeholder="http://patroni1:8008"
                  required={showPatroni}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="REST API username" hint="Only needed for switchover, restart and other write operations.">
                  <Input value={form.patroni_username ?? ''} onChange={(e) => set('patroni_username', e.target.value)} autoComplete="off" />
                </Field>
                <Field label="REST API password">
                  <Input
                    type="password"
                    value={form.patroni_password ?? ''}
                    placeholder={initial?.has_patroni_password && keepPatroniPassword ? '••••••••' : ''}
                    autoComplete="new-password"
                    onChange={(e) => {
                      set('patroni_password', e.target.value)
                      setKeepPatroniPassword(false)
                    }}
                  />
                </Field>
              </div>
            </div>
          )}
        </div>

        {testResult && <TestResult result={testResult} />}
        {save.error && <Alert tone="error">{save.error.message}</Alert>}

        <div className="flex justify-between pt-2">
          <Button type="button" variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
            <Plug className="h-4 w-4" /> Test connection
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {initial ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
