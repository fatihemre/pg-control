import { useQuery } from '@tanstack/react-query'
import { Ban, RefreshCw, XOctagon } from 'lucide-react'
import { useState } from 'react'
import { NoInstance, QueryState } from '../components/QueryState'
import { Badge, Button, Checkbox, EmptyRow, Input, PageHeader, Select, Table } from '../components/ui'
import { cx } from '../lib/cx'
import { activityQuery, type Session } from '../lib/catalog'
import { useBasket } from '../lib/changes'
import { useInstance } from '../lib/instance'
import { fmtSeconds, truncate } from '../lib/format'

const NO_SESSIONS: Session[] = []

const STATE_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = {
  active: 'ok',
  idle: 'neutral',
  'idle in transaction': 'warn',
  'idle in transaction (aborted)': 'bad',
}

export function ActivityPage() {
  const { current } = useInstance()
  const basket = useBasket()
  const [every, setEvery] = useState(0)
  const activity = useQuery({ ...activityQuery(current?.id ?? 0), enabled: !!current, refetchInterval: every || false })
  const [clientsOnly, setClientsOnly] = useState(true)
  const [state, setState] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

  const sessions = activity.data?.sessions ?? NO_SESSIONS
  const clients = sessions.filter((s) => s.backend_type === 'client backend')
  const q = search.trim().toLowerCase()
  const rows = sessions.filter(
    (s) =>
      (!clientsOnly || s.backend_type === 'client backend') &&
      (!state || s.state === state) &&
      (!q || [s.user, s.database, s.application_name, s.client_addr, s.query].some((v) => v?.toLowerCase().includes(q))),
  )

  const counts = {
    active: clients.filter((s) => s.state === 'active').length,
    idleTx: clients.filter((s) => s.state?.startsWith('idle in transaction')).length,
    waiting: clients.filter((s) => s.wait_event_type === 'Lock').length,
    blocked: clients.filter((s) => s.blocked_by.length > 0).length,
  }
  const blocked = activity.data?.blocked ?? []

  return (
    <>
      <PageHeader
        title="Activity"
        actions={
          <div className="flex items-center gap-3">
            <Select className="w-40" value={every} onChange={(e) => setEvery(Number(e.target.value))}>
              <option value={0}>No auto-refresh</option>
              <option value={2000}>Every 2 s</option>
              <option value={5000}>Every 5 s</option>
              <option value={15000}>Every 15 s</option>
            </Select>
            <Button variant="secondary" onClick={() => activity.refetch()} disabled={activity.isFetching}>
              <RefreshCw className={cx('h-4 w-4', activity.isFetching && 'animate-spin')} /> Refresh
            </Button>
          </div>
        }
      />
      {!current ? (
        <NoInstance />
      ) : activity.isSuccess ? (
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-3">
            <Stat label="Client sessions" value={clients.length} />
            <Stat label="Active" value={counts.active} />
            <Stat label="Idle in transaction" value={counts.idleTx} tone={counts.idleTx ? 'warn' : undefined} />
            <Stat label="Waiting on lock" value={counts.waiting} tone={counts.waiting ? 'warn' : undefined} />
            <Stat label="Blocked" value={counts.blocked} tone={counts.blocked ? 'bad' : undefined} />
          </div>

          {blocked.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-red-800">Lock waits</h2>
              <Table
                head={
                  <tr>
                    <th className="px-3 py-2">Waiting PID</th>
                    <th className="px-3 py-2">Blocked by</th>
                    <th className="px-3 py-2">Lock</th>
                    <th className="px-3 py-2">Relation</th>
                    <th className="px-3 py-2">Waiting</th>
                    <th className="px-3 py-2">Query</th>
                  </tr>
                }
              >
                {blocked.map((b, i) => (
                  <tr key={i} className="bg-red-50/40">
                    <td className="px-3 py-2 font-mono text-xs">
                      {b.pid}{' '}
                      <span className="text-ink-500">
                        {b.user}@{b.database}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{b.blocked_by.join(', ') || '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {b.locktype} · {b.mode}
                    </td>
                    <td
                      className="px-3 py-2 font-mono text-xs"
                      title={b.relation && /^\d+$/.test(b.relation) ? 'OID in another database; name not resolvable from the profile database' : ''}
                    >
                      {b.relation && /^\d+$/.test(b.relation) ? `oid ${b.relation}` : (b.relation ?? '')}
                    </td>
                    <td className="px-3 py-2 text-xs">{fmtSeconds(b.waiting_seconds)}</td>
                    <td className="max-w-md px-3 py-2 font-mono text-xs text-ink-700">{truncate(b.query, 120)}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Checkbox label="Client backends only" checked={clientsOnly} onChange={setClientsOnly} />
            <Select className="w-56" value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">Any state</option>
              <option value="active">active</option>
              <option value="idle">idle</option>
              <option value="idle in transaction">idle in transaction</option>
              <option value="idle in transaction (aborted)">idle in transaction (aborted)</option>
            </Select>
            <Input className="w-72" placeholder="Filter user, db, app, client, query…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Table
            head={
              <tr>
                <th className="px-3 py-2">PID</th>
                <th className="px-3 py-2">User / DB</th>
                <th className="px-3 py-2">Application</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Wait</th>
                <th className="px-3 py-2">Query / xact</th>
                <th className="px-3 py-2">Query</th>
                <th className="px-3 py-2"></th>
              </tr>
            }
          >
            {rows.map((s) => (
              <SessionRow
                key={s.pid}
                s={s}
                expanded={expanded === s.pid}
                onToggle={() => setExpanded(expanded === s.pid ? null : s.pid)}
                onCancel={() => basket.add({ op: 'cancel_backend', pid: s.pid }, null)}
                onTerminate={() => basket.add({ op: 'terminate_backend', pid: s.pid }, null)}
              />
            ))}
            {rows.length === 0 && <EmptyRow colSpan={9}>No sessions match.</EmptyRow>}
          </Table>
          <p className="text-xs text-ink-500">
            Cancel aborts the backend's current statement; Terminate closes the connection and rolls back its transaction. Both are queued as pending changes
            and audited.
          </p>
        </div>
      ) : (
        <QueryState query={activity} />
      )}
    </>
  )
}

function SessionRow({
  s,
  expanded,
  onToggle,
  onCancel,
  onTerminate,
}: {
  s: Session
  expanded: boolean
  onToggle: () => void
  onCancel: () => void
  onTerminate: () => void
}) {
  const tone = STATE_TONE[s.state ?? ''] ?? 'neutral'
  return (
    <tr className={cx('hover:bg-ink-50', s.blocked_by.length > 0 && 'bg-red-50/40', s.is_self && 'text-ink-400')}>
      <td className="px-3 py-2 font-mono text-xs">
        {s.pid}
        {s.is_self && <span className="ml-1 text-[10px] uppercase">(this)</span>}
      </td>
      <td className="px-3 py-2 font-mono text-xs">
        {s.user ?? ''}
        <span className="text-ink-400">@</span>
        {s.database ?? ''}
      </td>
      <td className="max-w-[10rem] truncate px-3 py-2 text-xs" title={s.application_name ?? ''}>
        {s.backend_type === 'client backend' ? s.application_name : <span className="text-ink-500">{s.backend_type}</span>}
      </td>
      <td className="px-3 py-2 font-mono text-xs">{s.client_addr ?? ''}</td>
      <td className="px-3 py-2 text-xs">
        {s.state && <Badge tone={tone}>{s.state}</Badge>}
        {s.blocked_by.length > 0 && (
          <span className="ml-1">
            <Badge tone="bad">blocked by {s.blocked_by.join(', ')}</Badge>
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-ink-600">{s.wait_event_type ? `${s.wait_event_type}: ${s.wait_event}` : ''}</td>
      <td className="whitespace-nowrap px-3 py-2 text-xs">
        {s.state === 'active' ? fmtSeconds(s.query_seconds) : '—'}
        <span className="text-ink-400"> / </span>
        {s.xact_start ? fmtSeconds(s.xact_seconds) : '—'}
      </td>
      <td className="max-w-md cursor-pointer px-3 py-2 font-mono text-xs text-ink-700" onClick={onToggle} title="Click to expand">
        {expanded ? <pre className="whitespace-pre-wrap">{s.query}</pre> : truncate(s.query, 90)}
      </td>
      <td className="px-3 py-2 text-right">
        {!s.is_self && s.backend_type === 'client backend' && (
          <span className="inline-flex gap-3 whitespace-nowrap">
            <button className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-amber-700" onClick={onCancel} title="pg_cancel_backend">
              <Ban className="h-3.5 w-3.5" /> Cancel
            </button>
            <button className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-red-700" onClick={onTerminate} title="pg_terminate_backend">
              <XOctagon className="h-3.5 w-3.5" /> Terminate
            </button>
          </span>
        )}
      </td>
    </tr>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'bad' }) {
  return (
    <div
      className={cx(
        'rounded-md border px-3 py-2',
        tone === 'bad' ? 'border-red-200 bg-red-50 text-red-900' : tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-ink-200 bg-white',
      )}
    >
      <div className="text-xs uppercase tracking-wide text-ink-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}
