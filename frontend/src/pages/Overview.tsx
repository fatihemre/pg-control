import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NoInstance, QueryState } from '../components/QueryState'
import { Sparkline, type SparkPoint } from '../components/Sparkline'
import { Badge, Button, PageHeader, Select } from '../components/ui'
import { cx } from '../lib/cx'
import { metricsQuery, overviewQuery, type MetricPoint, type Overview } from '../lib/catalog'
import { fmtBytes, fmtNum, fmtPct, fmtSeconds, fmtTime } from '../lib/format'
import { useInstance } from '../lib/instance'

type Tone = 'ok' | 'warn' | 'bad' | 'neutral'
type Check = { label: string; tone: Tone; detail: string; to?: string }

function healthChecks(o: Overview): Check[] {
  const checks: Check[] = []
  const usage = o.connections / Math.max(1, o.max_connections - o.reserved_connections)
  checks.push({
    label: 'Connections',
    tone: usage >= 0.9 ? 'bad' : usage >= 0.75 ? 'warn' : 'ok',
    detail: `${o.connections} of ${o.max_connections} (${fmtPct(usage, 0)} of the non-reserved slots)`,
    to: '/perf/activity',
  })
  checks.push({
    label: 'Transaction ID wraparound',
    tone: o.wraparound_ratio >= 0.9 ? 'bad' : o.wraparound_ratio >= 0.6 ? 'warn' : 'ok',
    detail: `oldest XID age ${fmtNum(o.oldest_xid_age)} in ${o.oldest_xid_database} — ${fmtPct(o.wraparound_ratio, 0)} of autovacuum_freeze_max_age (${fmtNum(o.autovacuum_freeze_max_age)})`,
    to: '/perf/tables',
  })
  checks.push({
    label: 'Idle in transaction',
    tone: (o.longest_idle_xact_seconds ?? 0) > 300 ? 'bad' : o.idle_in_transaction > 0 ? 'warn' : 'ok',
    detail: o.idle_in_transaction
      ? `${o.idle_in_transaction} session(s), longest ${fmtSeconds(o.longest_idle_xact_seconds)}`
      : 'no sessions holding open transactions',
    to: '/perf/activity',
  })
  checks.push({
    label: 'Lock waits',
    tone: o.waiting > 0 ? 'warn' : 'ok',
    detail: o.waiting ? `${o.waiting} session(s) waiting on a lock` : 'no sessions waiting on locks',
    to: '/perf/activity',
  })
  const hit = o.cache_hit_ratio
  checks.push({
    label: 'Buffer cache hit',
    tone: hit === null ? 'neutral' : hit < 0.9 && o.blks_read > 10000 ? 'warn' : 'ok',
    detail: hit === null ? 'no reads yet' : `${fmtPct(hit)} since ${fmtTime(o.stats_reset) === '—' ? 'startup' : fmtTime(o.stats_reset)}`,
    to: '/perf/databases',
  })
  const ckpt = o.checkpoints_timed + o.checkpoints_req
  const reqRatio = ckpt ? o.checkpoints_req / ckpt : 0
  checks.push({
    label: 'Checkpoints',
    tone: ckpt > 20 && reqRatio > 0.5 ? 'warn' : 'ok',
    detail: `${fmtNum(o.checkpoints_timed)} timed, ${fmtNum(o.checkpoints_req)} requested${ckpt > 20 && reqRatio > 0.5 ? ' — many requested checkpoints; consider raising max_wal_size' : ''}`,
    to: '/config/settings',
  })
  checks.push({
    label: 'Replication slots',
    tone: o.inactive_slots > 0 ? 'warn' : 'ok',
    detail: o.inactive_slots ? `${o.inactive_slots} inactive slot(s) retaining WAL` : `${o.standby_count} standby(s) connected, no inactive slots`,
    to: '/cluster/replication',
  })
  checks.push({
    label: 'Deadlocks',
    tone: o.deadlocks > 0 ? 'warn' : 'ok',
    detail: o.deadlocks ? `${fmtNum(o.deadlocks)} deadlock(s) since stats reset` : 'none since stats reset',
    to: '/perf/databases',
  })
  checks.push({
    label: 'Data checksums',
    tone: o.data_checksums ? 'ok' : 'neutral',
    detail: o.data_checksums ? 'enabled' : 'disabled (set at initdb time)',
  })
  checks.push({
    label: 'Autovacuum',
    tone: o.settings.autovacuum === 'off' ? 'bad' : 'ok',
    detail:
      o.settings.autovacuum === 'off' ? 'disabled — tables will bloat and XID age will grow unchecked' : `on, ${o.autovacuum_workers} worker(s) running now`,
    to: '/config/settings',
  })
  return checks
}

const TONE_CLASS: Record<Tone, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  bad: 'border-red-200 bg-red-50 text-red-900',
  neutral: 'border-ink-200 bg-white text-ink-700',
}

export function OverviewPage() {
  const { current } = useInstance()
  const ov = useQuery({ ...overviewQuery(current?.id ?? 0), enabled: !!current, refetchInterval: 15_000 })
  const o = ov.data
  return (
    <>
      <PageHeader
        title="Overview"
        actions={
          <Button variant="secondary" onClick={() => ov.refetch()} disabled={ov.isFetching}>
            <RefreshCw className={cx('h-4 w-4', ov.isFetching && 'animate-spin')} /> Refresh
          </Button>
        }
      />
      {!current ? (
        <NoInstance />
      ) : o ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-700">
            <span className="font-mono text-xs">{o.version.split(' on ')[0]}</span>
            <Badge tone={o.in_recovery ? 'warn' : 'ok'}>{o.in_recovery ? 'standby (in recovery)' : 'primary'}</Badge>
            <span>
              up <b>{fmtSeconds(o.uptime_seconds)}</b> since {fmtTime(o.start_time)}
            </span>
            <span>
              data <b>{fmtBytes(o.total_db_bytes)}</b>
            </span>
            {o.wal_bytes !== null && (
              <span>
                WAL <b>{fmtBytes(o.wal_bytes)}</b>
              </span>
            )}
            {o.current_wal_lsn && <span className="font-mono text-xs text-ink-500">LSN {o.current_wal_lsn}</span>}
          </div>

          <div className="grid grid-cols-5 gap-3">
            <Stat label="Connections" value={`${o.connections} / ${o.max_connections}`} />
            <Stat label="Active" value={o.active} />
            <Stat label="Idle in transaction" value={o.idle_in_transaction} tone={o.idle_in_transaction ? 'warn' : undefined} />
            <Stat label="Waiting on lock" value={o.waiting} tone={o.waiting ? 'warn' : undefined} />
            <Stat label="Cache hit" value={fmtPct(o.cache_hit_ratio)} />
          </div>

          <Trends profileId={current.id} />

          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink-800">Health checks</h2>
            <div className="grid grid-cols-2 gap-3">
              {healthChecks(o).map((c) => (
                <div key={c.label} className={cx('flex items-start gap-3 rounded-md border px-3 py-2', TONE_CLASS[c.tone])}>
                  <span
                    className={cx(
                      'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
                      c.tone === 'ok' ? 'bg-emerald-500' : c.tone === 'warn' ? 'bg-amber-500' : c.tone === 'bad' ? 'bg-red-500' : 'bg-ink-300',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {c.to ? (
                        <Link to={c.to} className="hover:underline">
                          {c.label}
                        </Link>
                      ) : (
                        c.label
                      )}
                    </div>
                    <div className="text-xs opacity-80">{c.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-2 gap-6">
            <section>
              <h2 className="mb-2 text-sm font-semibold text-ink-800">Activity since stats reset</h2>
              <KV
                rows={[
                  ['Commits / rollbacks', `${fmtNum(o.xact_commit)} / ${fmtNum(o.xact_rollback)}`],
                  ['Blocks hit / read', `${fmtNum(o.blks_hit)} / ${fmtNum(o.blks_read)}`],
                  ['Temp bytes written', fmtBytes(o.temp_bytes)],
                  ['Deadlocks', fmtNum(o.deadlocks)],
                  ['Longest running query', fmtSeconds(o.longest_xact_seconds)],
                  ['Checkpoint write / sync time', `${fmtSeconds(o.checkpoint_write_time / 1000)} / ${fmtSeconds(o.checkpoint_sync_time / 1000)}`],
                  ['Buffers written by checkpoints', fmtNum(o.buffers_checkpoint)],
                  ...(o.buffers_backend !== null ? [['Buffers written by backends', fmtNum(o.buffers_backend)] as [string, ReactNode]] : []),
                  ['Oldest multixact age', fmtNum(o.oldest_mxid_age)],
                  ['Stats reset', fmtTime(o.stats_reset)],
                ]}
              />
            </section>
            <section>
              <h2 className="mb-2 text-sm font-semibold text-ink-800">
                Key settings{' '}
                <Link to="/config/settings" className="ml-1 text-xs font-normal text-accent-700 hover:underline">
                  all settings
                </Link>
              </h2>
              <KV
                rows={Object.entries(o.settings).map(([k, v]) => [
                  k,
                  <span key={k} className="font-mono text-xs">
                    {v || <span className="text-ink-400">(empty)</span>}
                  </span>,
                ])}
              />
            </section>
          </div>
        </div>
      ) : (
        <QueryState query={ov} />
      )}
    </>
  )
}

const RANGES = [
  [1, 'Last hour'],
  [6, 'Last 6 hours'],
  [24, 'Last 24 hours'],
  [72, 'Last 3 days'],
] as const

type Series = { label: string; pick: (p: MetricPoint) => number | null; format: (v: number) => string; tone?: 'accent' | 'warn' }

const SERIES: Series[] = [
  { label: 'Connections', pick: (p) => p.connections, format: (v) => fmtNum(Math.round(v)) },
  { label: 'Commits / s', pick: (p) => p.commits_per_s, format: (v) => v.toFixed(1) },
  { label: 'Rollbacks / s', pick: (p) => p.rollbacks_per_s, format: (v) => v.toFixed(2), tone: 'warn' },
  { label: 'Cache hit', pick: (p) => p.cache_hit, format: (v) => fmtPct(v) },
  { label: 'WAL / s', pick: (p) => p.wal_bytes_per_s, format: (v) => `${fmtBytes(v)}/s` },
  { label: 'Idle in transaction', pick: (p) => p.idle_in_transaction, format: (v) => fmtNum(Math.round(v)), tone: 'warn' },
  { label: 'Lock waits', pick: (p) => p.waiting, format: (v) => fmtNum(Math.round(v)), tone: 'warn' },
  { label: 'Database size', pick: (p) => p.db_bytes, format: (v) => fmtBytes(v) },
  { label: 'Replication lag', pick: (p) => p.lag_bytes, format: (v) => fmtBytes(v), tone: 'warn' },
  { label: 'Oldest XID age', pick: (p) => p.oldest_xid_age, format: (v) => fmtNum(Math.round(v)) },
]

function Trends({ profileId }: { profileId: number }) {
  const [hours, setHours] = useState<number>(6)
  const m = useQuery({ ...metricsQuery(profileId, hours), refetchInterval: 60_000 })
  const points = m.data?.points ?? []
  const last = points.at(-1)
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-4">
        <h2 className="min-w-0 text-sm font-semibold text-ink-800">
          Trends{' '}
          {m.data && (
            <span className="ml-1 text-xs font-normal text-ink-500">
              {m.data.interval_seconds > 0
                ? `sampled every ${fmtSeconds(m.data.interval_seconds)}, ${m.data.retention_hours}h kept · ${points.length} sample(s)`
                : 'background sampler disabled (PGCONTROL_METRICS_INTERVAL_SECONDS=0)'}
            </span>
          )}
        </h2>
        <span className="shrink-0">
          <Select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {RANGES.map(([h, label]) => (
              <option key={h} value={h}>
                {label}
              </option>
            ))}
          </Select>
        </span>
      </div>
      {m.isError ? (
        <div className="text-xs text-red-700">{(m.error as Error).message}</div>
      ) : (
        <div className="grid grid-cols-5 gap-3">
          {SERIES.filter((s) => s.label !== 'Replication lag' || points.some((p) => p.lag_bytes !== null)).map((s) => {
            const data: SparkPoint[] = points.map((p) => ({ t: p.t, v: s.pick(p) }))
            const cur = last ? s.pick(last) : null
            return (
              <div key={s.label} className="rounded-md border border-ink-200 bg-white px-3 py-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs uppercase tracking-wide text-ink-500">{s.label}</span>
                  <span className="font-mono text-xs text-ink-700">{cur === null || cur === undefined ? '—' : s.format(cur)}</span>
                </div>
                <div className="mt-1">
                  <Sparkline points={data} format={s.format} tone={s.tone} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warn' | 'bad' }) {
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

function KV({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="divide-y divide-ink-100 rounded-md border border-ink-200 bg-white text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4 px-3 py-1.5">
          <dt className="text-ink-600">{k}</dt>
          <dd className="text-right">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
