import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { NoInstance, QueryState } from '../components/QueryState'
import { RoleBadges } from '../components/RoleBadges'
import { Badge, Button, PageHeader } from '../components/ui'
import { roleQuery, type ClosureEntry, type Membership } from '../lib/catalog'
import { useInstance } from '../lib/instance'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-ink-200 bg-white">
      <h2 className="border-b border-ink-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</h2>
      <div className="px-4 py-3 text-sm">{children}</div>
    </section>
  )
}

function Yes({ v }: { v: boolean }) {
  return v ? <span className="text-emerald-700">yes</span> : <span className="text-ink-400">no</span>
}

function MembershipTable({ rows, column }: { rows: Membership[]; column: string }) {
  if (!rows.length) return <div className="text-ink-500">None</div>
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-ink-500">
        <tr>
          <th className="py-1 pr-3 font-medium">{column}</th>
          <th className="py-1 pr-3 font-medium">Grantor</th>
          <th className="py-1 pr-3 font-medium">Admin</th>
          <th className="py-1 pr-3 font-medium">Inherit</th>
          <th className="py-1 pr-3 font-medium">Set</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.role} className="border-t border-ink-100">
            <td className="py-1 pr-3 font-mono">
              <Link to="/roles/$name" params={{ name: m.role }} className="text-accent-700 hover:underline">
                {m.role}
              </Link>
            </td>
            <td className="py-1 pr-3 font-mono text-xs text-ink-700">{m.grantor ?? '—'}</td>
            <td className="py-1 pr-3">
              <Yes v={m.admin_option} />
            </td>
            <td className="py-1 pr-3">
              <Yes v={m.inherit_option} />
            </td>
            <td className="py-1 pr-3">
              <Yes v={m.set_option} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Chain({ path }: { path: string[] }) {
  return (
    <span className="font-mono text-xs">
      {path.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="text-ink-400"> → </span>}
          {i === path.length - 1 ? (
            <Link to="/roles/$name" params={{ name: p }} className="text-accent-700 hover:underline">
              {p}
            </Link>
          ) : (
            <span className="text-ink-700">{p}</span>
          )}
        </span>
      ))}
    </span>
  )
}

function ClosureList({ rows, empty }: { rows: ClosureEntry[]; empty: string }) {
  if (!rows.length) return <div className="text-ink-500">{empty}</div>
  return (
    <ul className="space-y-1">
      {rows.map((e) => (
        <li key={e.oid} className="flex items-center gap-2">
          <Chain path={e.path} />
          {!e.inherited && <Badge tone="warn">not inherited</Badge>}
        </li>
      ))}
    </ul>
  )
}

export function RoleDetailPage() {
  const { name } = useParams({ from: '/app/roles/$name' })
  const { current } = useInstance()
  const query = useQuery({ ...roleQuery(current?.id ?? 0, name), enabled: !!current })

  return (
    <>
      <PageHeader
        title={name}
        actions={
          <div className="flex items-center gap-2">
            <Link to="/roles">
              <Button variant="ghost">
                <ArrowLeft className="h-4 w-4" /> Roles
              </Button>
            </Link>
            <Link to="/security/effective" search={{ role: name }}>
              <Button variant="secondary">
                <ShieldCheck className="h-4 w-4" /> Effective privileges
              </Button>
            </Link>
          </div>
        }
      />
      {!current ? (
        <NoInstance />
      ) : query.isSuccess ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Attributes">
            <div className="mb-3">
              <RoleBadges role={query.data.role} />
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-500">OID</dt>
              <dd className="font-mono">{query.data.role.oid}</dd>
              <dt className="text-ink-500">Connection limit</dt>
              <dd className="font-mono">{query.data.role.connlimit === -1 ? 'unlimited' : query.data.role.connlimit}</dd>
              <dt className="text-ink-500">Valid until</dt>
              <dd className="font-mono">{query.data.role.valid_until ?? 'never expires'}</dd>
              <dt className="text-ink-500">Inherits</dt>
              <dd>
                <Yes v={query.data.role.inherit} />
              </dd>
            </dl>
          </Card>
          <Card title="Role settings (ALTER ROLE … SET)">
            {query.data.role.config.length ? (
              <ul className="space-y-1 font-mono text-xs">
                {query.data.role.config.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : (
              <div className="text-ink-500">None</div>
            )}
          </Card>
          <Card title="Member of (direct)">
            <MembershipTable rows={query.data.member_of} column="Role" />
          </Card>
          <Card title="Members (direct)">
            <MembershipTable rows={query.data.members} column="Member" />
          </Card>
          <Card title="Inherits privileges from (transitive)">
            <ClosureList rows={query.data.inherits_from} empty="No memberships" />
          </Card>
          <Card title="Privileges inherited by (transitive)">
            <ClosureList rows={query.data.inherited_by} empty="No members" />
          </Card>
        </div>
      ) : (
        <QueryState query={query} />
      )}
    </>
  )
}
