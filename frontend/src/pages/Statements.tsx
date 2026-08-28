import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DatabasePicker } from '../components/DatabasePicker'
import { NoInstance, QueryState } from '../components/QueryState'
import { Alert, Badge, Button, EmptyRow, Input, PageHeader, Select, Table } from '../components/ui'
import { statementsQuery, type StatementOrder } from '../lib/catalog'
import { useBasket } from '../lib/changes'
import { useDatabase, useInstance } from '../lib/instance'
import { fmtBytes, fmtMs, fmtNum, fmtPct, truncate } from '../lib/format'

export function StatementsPage() {
  const { current } = useInstance()
  const { db, profileId } = useDatabase()
  const basket = useBasket()
  const [order, setOrder] = useState<StatementOrder>('total_time')
  const [limit, setLimit] = useState(50)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const stmts = useQuery({ ...statementsQuery(profileId, db, order, limit), enabled: !!current && !!db })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (stmts.data?.rows ?? []).filter((r) => !q || r.query.toLowerCase().includes(q) || r.user.toLowerCase().includes(q))
  }, [stmts.data, search])
  const total = stmts.data?.total_time ?? 0

  return (
    <>
      <PageHeader
        title="Statements"
        actions={
          <div className="flex items-center gap-3">
            <DatabasePicker />
            <Select className="w-44" value={order} onChange={(e) => setOrder(e.target.value as StatementOrder)}>
              <option value="total_time">By total time</option>
              <option value="mean_time">By mean time</option>
              <option value="calls">By calls</option>
              <option value="rows">By rows</option>
              <option value="shared_read">By shared reads</option>
              <option value="temp">By temp writes</option>
            </Select>
            <Select className="w-24" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[20, 50, 100, 250].map((n) => (
                <option key={n} value={n}>
                  Top {n}
                </option>
              ))}
            </Select>
            <Input className="w-48" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button variant="secondary" onClick={() => basket.add({ op: 'reset_statements' }, db)} disabled={!stmts.data?.available}>
              <RotateCcw className="h-4 w-4" /> Reset statistics
            </Button>
          </div>
        }
      />
      {!current ? (
        <NoInstance />
      ) : stmts.isSuccess ? (
        !stmts.data.available ? (
          <div className="space-y-3">
            <Alert tone="error">{stmts.data.reason}</Alert>
            <p className="text-sm text-ink-600">
              Set <span className="font-mono">shared_preload_libraries = 'pg_stat_statements'</span> under{' '}
              <Link to="/config/settings" className="text-accent-700 hover:underline">
                Server settings
              </Link>{' '}
              (restart required), then install the extension from{' '}
              <Link to="/config/extensions" className="text-accent-700 hover:underline">
                Extensions
              </Link>{' '}
              in database <span className="font-mono">{db}</span>.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Table
              head={
                <tr>
                  <th className="px-3 py-2">Query</th>
                  <th className="px-3 py-2 text-right">Calls</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">% of total</th>
                  <th className="px-3 py-2 text-right">Mean</th>
                  <th className="px-3 py-2 text-right">Max</th>
                  <th className="px-3 py-2 text-right">Rows</th>
                  <th className="px-3 py-2 text-right">Shared hit / read</th>
                  <th className="px-3 py-2 text-right">Temp written</th>
                  <th className="px-3 py-2">User / DB</th>
                </tr>
              }
            >
              {rows.map((r) => {
                const key = `${r.queryid}:${r.user}:${r.database}:${r.toplevel}`
                const hitRatio = r.shared_blks_hit + r.shared_blks_read > 0 ? r.shared_blks_hit / (r.shared_blks_hit + r.shared_blks_read) : null
                return (
                  <tr key={key} className="align-top hover:bg-ink-50">
                    <td className="max-w-lg cursor-pointer px-3 py-2 font-mono text-xs text-ink-800" onClick={() => setExpanded(expanded === key ? null : key)}>
                      {expanded === key ? <pre className="whitespace-pre-wrap">{r.query}</pre> : truncate(r.query, 110)}
                      {!r.toplevel && (
                        <span className="ml-1">
                          <Badge>nested</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">{fmtNum(r.calls)}</td>
                    <td className="px-3 py-2 text-right text-xs">{fmtMs(r.total_exec_time)}</td>
                    <td className="px-3 py-2 text-right text-xs">{total > 0 ? fmtPct(r.total_exec_time / total) : '—'}</td>
                    <td className="px-3 py-2 text-right text-xs">{fmtMs(r.mean_exec_time)}</td>
                    <td className="px-3 py-2 text-right text-xs">{fmtMs(r.max_exec_time)}</td>
                    <td className="px-3 py-2 text-right text-xs">{fmtNum(r.rows)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs" title={hitRatio !== null ? `cache hit ${fmtPct(hitRatio)}` : ''}>
                      {fmtNum(r.shared_blks_hit)} / {fmtNum(r.shared_blks_read)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">{r.temp_blks_written ? fmtBytes(r.temp_blks_written * 8192) : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink-600">
                      {r.user}
                      <span className="text-ink-400">@</span>
                      {r.database ?? '?'}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && <EmptyRow colSpan={10}>No statements recorded.</EmptyRow>}
            </Table>
            <p className="text-xs text-ink-500">
              Times are execution time (planning excluded). Counters accumulate since the last reset; "% of total" is relative to all statements in the view, not
              just those shown.
            </p>
          </div>
        )
      ) : (
        <QueryState query={stmts} />
      )}
    </>
  )
}
