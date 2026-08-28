import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { Alert, Button, Field, Input } from '../components/ui'
import { useLogin } from '../lib/auth'

export function LoginPage() {
  const login = useLogin()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    login.mutate({ username, password }, { onSuccess: () => navigate({ to: '/' }) })
  }

  return (
    <div className="grid h-full place-items-center bg-ink-950">
      <form onSubmit={submit} className="w-80 space-y-4 rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded bg-accent-500 font-mono font-bold text-ink-950">
            pg
          </span>
          <span className="text-lg font-semibold">PgControl</span>
        </div>
        <Field label="Username">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        {login.error && <Alert tone="error">{login.error.message}</Alert>}
        <Button type="submit" className="w-full justify-center" disabled={login.isPending}>
          Sign in
        </Button>
      </form>
    </div>
  )
}
