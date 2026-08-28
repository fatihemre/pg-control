import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { Database, KeyRound, LogOut, Settings2, ShieldCheck, Users } from 'lucide-react'
import type { ComponentType } from 'react'
import { useLogout, useMe } from '../lib/auth'
import { cx } from './ui'

type NavItem = { label: string; to: string; ready?: boolean }
type NavSection = { label: string; icon: ComponentType<{ className?: string }>; items: NavItem[] }

const NAV: NavSection[] = [
  {
    label: 'Connections',
    icon: Database,
    items: [{ label: 'Instances', to: '/connections', ready: true }],
  },
  {
    label: 'Configuration',
    icon: Settings2,
    items: [
      { label: 'Server settings', to: '/config/settings' },
      { label: 'Runtime parameters', to: '/config/runtime' },
      { label: 'Extensions', to: '/config/extensions' },
    ],
  },
  {
    label: 'Users & Roles',
    icon: Users,
    items: [
      { label: 'Roles', to: '/roles' },
      { label: 'Memberships', to: '/roles/memberships' },
      { label: 'Attributes', to: '/roles/attributes' },
    ],
  },
  {
    label: 'Permissions',
    icon: KeyRound,
    items: [
      { label: 'Database', to: '/permissions/database' },
      { label: 'Schema', to: '/permissions/schema' },
      { label: 'Table', to: '/permissions/table' },
      { label: 'Sequence', to: '/permissions/sequence' },
      { label: 'Function', to: '/permissions/function' },
    ],
  },
  {
    label: 'Security',
    icon: ShieldCheck,
    items: [
      { label: 'Effective privileges', to: '/security/effective' },
      { label: 'Ownership', to: '/security/ownership' },
      { label: 'Grants', to: '/security/grants' },
    ],
  },
]

export function Layout() {
  const me = useMe()
  const logout = useLogout()
  const navigate = useNavigate()

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-950 text-ink-100">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="grid h-7 w-7 place-items-center rounded bg-accent-500 font-mono text-sm font-bold text-ink-950">
            pg
          </span>
          <span className="text-base font-semibold tracking-tight">PgControl</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {NAV.map((section) => (
            <div key={section.label} className="mt-3">
              <div className="flex items-center gap-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                <section.icon className="h-3.5 w-3.5" />
                {section.label}
              </div>
              {section.items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cx(
                    'block rounded px-2 py-1 pl-7 text-sm text-ink-300 hover:bg-ink-800 hover:text-white',
                    !item.ready && 'opacity-50',
                  )}
                  activeProps={{ className: 'bg-ink-800 text-white' }}
                  activeOptions={{ exact: true }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="flex items-center justify-between border-t border-ink-800 px-4 py-3 text-sm">
          <div>
            <div className="font-medium">{me.data?.username}</div>
            <div className="font-mono text-xs text-ink-500">{me.data?.role}</div>
          </div>
          <button
            className="rounded p-1.5 text-ink-300 hover:bg-ink-800 hover:text-white"
            title="Sign out"
            onClick={() => logout.mutate(undefined, { onSuccess: () => navigate({ to: '/login' }) })}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <Outlet />
      </main>
    </div>
  )
}
