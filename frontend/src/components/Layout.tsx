import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { Database, Gauge, KeyRound, LogOut, Server, Settings2, ShieldCheck, UserCog, Users } from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { useLogout, useMe } from '../lib/auth'
import { InstanceProvider } from '../lib/instance'
import { BasketButton, BasketModal } from './Basket'
import { InstancePicker } from './InstancePicker'
import { BasketProvider } from '../lib/changes'
import { cx } from './ui'
import { ChangePasswordModal } from '../pages/Users'

type NavItem = { label: string; to: string; ready?: boolean }
type NavSection = { label: string; icon: ComponentType<{ className?: string }>; items: NavItem[] }

const NAV: NavSection[] = [
  {
    label: 'Connections',
    icon: Database,
    items: [{ label: 'Instances', to: '/connections', ready: true }],
  },
  {
    label: 'Cluster',
    icon: Server,
    items: [
      { label: 'Overview', to: '/cluster/overview', ready: true },
      { label: 'Replication', to: '/cluster/replication', ready: true },
    ],
  },
  {
    label: 'Configuration',
    icon: Settings2,
    items: [
      { label: 'Server settings', to: '/config/settings', ready: true },
      { label: 'Role & DB overrides', to: '/config/overrides', ready: true },
      { label: 'Client auth (pg_hba)', to: '/config/hba', ready: true },
      { label: 'Extensions', to: '/config/extensions', ready: true },
    ],
  },
  {
    label: 'Users & Roles',
    icon: Users,
    items: [
      { label: 'Roles', to: '/roles', ready: true },
      { label: 'Memberships', to: '/roles/memberships', ready: true },
      { label: 'Attributes', to: '/roles/attributes', ready: true },
    ],
  },
  {
    label: 'Permissions',
    icon: KeyRound,
    items: [
      { label: 'Database', to: '/permissions/database', ready: true },
      { label: 'Schema', to: '/permissions/schema', ready: true },
      { label: 'Table', to: '/permissions/table', ready: true },
      { label: 'Sequence', to: '/permissions/sequence', ready: true },
      { label: 'Function', to: '/permissions/function', ready: true },
    ],
  },
  {
    label: 'Security',
    icon: ShieldCheck,
    items: [
      { label: 'Effective privileges', to: '/security/effective', ready: true },
      { label: 'Ownership', to: '/security/ownership', ready: true },
      { label: 'Grants', to: '/security/grants', ready: true },
      { label: 'Audit log', to: '/security/audit', ready: true },
    ],
  },
  {
    label: 'Performance',
    icon: Gauge,
    items: [
      { label: 'Activity', to: '/perf/activity', ready: true },
      { label: 'Statements', to: '/perf/statements', ready: true },
      { label: 'Tables & indexes', to: '/perf/tables', ready: true },
      { label: 'Databases', to: '/perf/databases', ready: true },
    ],
  },
  {
    label: 'Administration',
    icon: UserCog,
    items: [{ label: 'Users', to: '/admin/users', ready: true }],
  },
]

export function Layout() {
  const me = useMe()
  const logout = useLogout()
  const navigate = useNavigate()
  const [changingPassword, setChangingPassword] = useState(false)

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-950 text-ink-100">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="grid h-7 w-7 place-items-center rounded bg-accent-500 font-mono text-sm font-bold text-ink-950">pg</span>
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
                  className={cx('block rounded px-2 py-1 pl-7 text-sm text-ink-300 hover:bg-ink-800 hover:text-white', !item.ready && 'opacity-50')}
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
          <div className="flex gap-1">
            {me.data?.auth_provider !== 'oidc' && (
              <button
                className="rounded p-1.5 text-ink-300 hover:bg-ink-800 hover:text-white"
                title="Change password"
                onClick={() => setChangingPassword(true)}
              >
                <KeyRound className="h-4 w-4" />
              </button>
            )}
            <button
              className="rounded p-1.5 text-ink-300 hover:bg-ink-800 hover:text-white"
              title="Sign out"
              onClick={() => logout.mutate(undefined, { onSuccess: () => navigate({ to: '/login' }) })}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
      </aside>
      <InstanceProvider>
        <BasketProvider>
          <div className="flex flex-1 flex-col overflow-hidden">
            <header className="flex h-12 shrink-0 items-center border-b border-ink-200 bg-white px-8">
              <InstancePicker />
            </header>
            <main className="flex-1 overflow-y-auto px-8 py-6">
              <Outlet />
            </main>
          </div>
          <BasketButton />
          <BasketModal />
        </BasketProvider>
      </InstanceProvider>
    </div>
  )
}
