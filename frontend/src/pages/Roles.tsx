import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { NoInstance, QueryState } from '../components/QueryState'
import { RoleBadges } from '../components/RoleBadges'
import { Input, PageHeader } from '../components/ui'
import { rolesQuery } from '../lib/catalog'
import { useInstance } from '../lib/instance'

export function RolesPage() {
  const { current } = useInstance()
  const [search, setSearch] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const query = useQuery({ ...rolesQuery(current?.id ?? 0), enabled: !!current })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (query.data ?? []).filter(
      (r) => (showSystem || !r.is_system) && (!q || r.name.toLowerCase().includes(q) || r.member_of.some((m) => m.includes(q))),
    )
  }, [query.data, search, showSystem])

  return (
    <>
      <PageHeader
        title="Roles"
        actions={
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-ink-700">
              <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} />
              System roles
            </label>
            <Input
              className="w-64"
              placeholder="Filter roles…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        }
      />
      {!current ? (
        <NoInstance />
      ) : query.isSuccess ? (
        <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Attributes</th>
                <th className="px-3 py-2">Member of</th>
                <th className="px-3 py-2 text-right">Conn. limit</th>
                <th className="px-3 py-2">Valid until</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => (
                <tr key={r.oid} className="hover:bg-ink-50">
                  <td className="px-3 py-2 font-mono">
                    <Link to="/roles/$name" params={{ name: r.name }} className="text-accent-700 hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <RoleBadges role={r} compact />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-700">
                    {r.member_of.map((m, i) => (
                      <span key={m}>
                        {i > 0 && ', '}
                        <Link to="/roles/$name" params={{ name: m }} className="hover:underline">
                          {m}
                        </Link>
                      </span>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{r.connlimit === -1 ? '∞' : r.connlimit}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-700">
                    {r.valid_until ? r.valid_until.slice(0, 19).replace('T', ' ') : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      to="/security/effective"
                      search={{ role: r.name }}
                      className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-accent-700"
                      title="Effective privileges"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Effective
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-ink-500">
                    No roles match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <QueryState query={query} />
      )}
    </>
  )
}
