import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Alert, Button, Field, Input } from '../components/ui'
import { providersQuery, useLogin } from '../lib/auth'

export function LoginPage() {
  const login = useLogin()
  const navigate = useNavigate()
  const { error } = useSearch({ from: '/login' })
  const providers = useQuery(providersQuery)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const sso = providers.data?.oidc ?? null

  function submit(e: FormEvent) {
    e.preventDefault()
    login.mutate({ username, password }, { onSuccess: () => navigate({ to: '/' }) })
  }

  return (
    <div className="grid h-full place-items-center bg-ink-950">
      <form onSubmit={submit} className="w-80 space-y-4 rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded bg-accent-500 font-mono font-bold text-ink-950">pg</span>
          <span className="text-lg font-semibold">PgControl</span>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {sso && (
          <>
            <a
              href="/api/auth/oidc/login"
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-ink-300 bg-white px-3 py-2 text-sm font-medium text-ink-800 hover:bg-ink-50"
            >
              <KeyRound className="h-4 w-4" /> Continue with {sso.name}
            </a>
            <div className="flex items-center gap-3 text-xs text-ink-400">
              <span className="h-px flex-1 bg-ink-200" />
              or sign in with a local account
              <span className="h-px flex-1 bg-ink-200" />
            </div>
          </>
        )}
        <Field label="Username">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!sso} autoComplete="username" />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        {login.error && <Alert tone="error">{login.error.message}</Alert>}
        <Button type="submit" className="w-full justify-center" disabled={login.isPending}>
          Sign in
        </Button>
      </form>
    </div>
  )
}
