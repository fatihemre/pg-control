import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeftRight, Pause, Play, RefreshCw, RotateCw, Zap } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NoInstance, QueryState } from '../components/QueryState'
import { Alert, Badge, Button, Checkbox, EmptyRow, Field, Input, Modal, PageHeader, Select, Table } from '../components/ui'
import { cx } from '../lib/cx'
import { api } from '../lib/api'
import { patroniQuery, type PatroniMember, type PatroniOperation, type PatroniStatus } from '../lib/catalog'
import { useMe } from '../lib/auth'
import { fmtBytes, fmtSeconds, fmtTime } from '../lib/format'
import { useInstance } from '../lib/instance'

type Op =
  | { kind: 'switchover' }
  | { kind: 'failover' }
  | { kind: 'pause'; paused: boolean }
  | { kind: 'restart'; member: PatroniMember }
  | { kind: 'reinitialize'; member: PatroniMember }
  | { kind: 'reload'; member: PatroniMember }
  | { kind: 'cancel_switchover' }
  | { kind: 'cancel_restart'; member: PatroniMember }

const LEADER_ROLES = ['leader', 'standby_leader', 'master', 'primary']

function isLeader(m: PatroniMember) {
  return LEADER_ROLES.includes(m.role)
}

function roleTone(m: PatroniMember): 'ok' | 'warn' | 'bad' | 'neutral' {
  if (isLeader(m)) return 'ok'
  if (m.role === 'sync_standby') return 'ok'
  return 'neutral'
}

function stateTone(state: string): 'ok' | 'warn' | 'bad' | 'neutral' {
  if (state === 'running' || state === 'streaming') return 'ok'
  if (state === 'stopped' || state === 'crashed' || state.startsWith('stop')) return 'bad'
  return 'warn'
}

export function PatroniPage() {
  const { current } = useInstance()
  const me = useMe()
  const canWrite = (me.data?.role ?? 'viewer') !== 'viewer' && !current?.read_only
  const [every, setEvery] = useState(5000)
  const status = useQuery({
    ...patroniQuery(current?.id ?? 0),
    enabled: !!current?.patroni_url,
    refetchInterval: every || false,
  })
  const [op, setOp] = useState<Op | null>(null)
  const s = status.data

  return (
    <>
      <PageHeader
        title="Patroni"
        actions={
          <div className="flex items-center gap-3">
            <Select className="w-40" value={every} onChange={(e) => setEvery(Number(e.target.value))}>
              <option value={0}>No auto-refresh</option>
              <option value={2000}>Every 2 s</option>
              <option value={5000}>Every 5 s</option>
              <option value={15000}>Every 15 s</option>
            </Select>
            <Button variant="secondary" onClick={() => status.refetch()} disabled={status.isFetching || !current?.patroni_url}>
              <RefreshCw className={cx('h-4 w-4', status.isFetching && 'animate-spin')} /> Refresh
            </Button>
          </div>
        }
      />
      {!current ? (
        <NoInstance />
      ) : !current.patroni_url ? (
        <div className="rounded-md border border-dashed border-ink-300 bg-white p-6 text-sm text-ink-600">
          <p>
            <b>{current.name}</b> has no Patroni REST API configured.
          </p>
          <p className="mt-1">
            Edit the instance under{' '}
            <Link to="/connections" className="text-accent-700 underline">
              Connections
            </Link>
            , tick “Managed by Patroni” and enter the REST API URL of any cluster member to see members, leader, lag and timeline history here and to run
            switchovers, failovers and restarts.
          </p>
        </div>
      ) : s ? (
        <div className="space-y-6">
          <Summary s={s} profileUrl={current.patroni_url} />
          {s.pause && <Alert tone="error">Cluster management is paused: Patroni will not perform automatic failover until it is resumed.</Alert>}
          {s.scheduled_switchover && (
            <Alert tone="ok">
              Switchover scheduled at {fmtTime(s.scheduled_switchover.at)} from <b>{s.scheduled_switchover.from ?? '?'}</b> to{' '}
              <b>{s.scheduled_switchover.to ?? 'the best replica'}</b>.
              {canWrite && (
                <button className="ml-2 underline" onClick={() => setOp({ kind: 'cancel_switchover' })}>
                  Cancel it
                </button>
              )}
            </Alert>
          )}
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setOp({ kind: 'switchover' })} disabled={!s.leader}>
                <ArrowLeftRight className="h-4 w-4" /> Switchover
              </Button>
              <Button variant="secondary" onClick={() => setOp({ kind: 'failover' })}>
                <Zap className="h-4 w-4" /> Failover
              </Button>
              <Button variant="secondary" onClick={() => setOp({ kind: 'pause', paused: !s.pause })}>
                {s.pause ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />} {s.pause ? 'Resume management' : 'Pause management'}
              </Button>
            </div>
          )}
          <Members s={s} canWrite={canWrite} onOp={setOp} />
          <div className="grid grid-cols-2 gap-6">
            <History s={s} />
            <Config s={s} />
          </div>
        </div>
      ) : (
        <QueryState query={status} />
      )}
      {op && current && s && <OperationModal op={op} s={s} profileId={current.id} onClose={() => setOp(null)} />}
    </>
  )
}

function Summary({ s, profileUrl }: { s: PatroniStatus; profileUrl: string }) {
  const n = s.node
  const timelines = new Set(s.members.map((m) => m.timeline).filter((t) => t !== null))
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-700">
      <span>
        scope <b className="font-mono text-xs">{s.scope ?? '?'}</b>
      </span>
      <span>leader {s.leader ? <b className="font-mono text-xs">{s.leader}</b> : <Badge tone="bad">none</Badge>}</span>
      <span>
        members <b>{s.members.length}</b>
      </span>
      {timelines.size > 1 && <Badge tone="warn">members on {timelines.size} different timelines</Badge>}
      {s.patroni_version && (
        <span>
          Patroni <b className="font-mono text-xs">{s.patroni_version}</b>
        </span>
      )}
      {n.name && (
        <span className="text-ink-500">
          via <span className="font-mono text-xs">{n.name}</span> ({n.role ?? '?'}, {n.state ?? '?'}
          {n.dcs_last_seen ? `, DCS seen ${fmtTime(n.dcs_last_seen)}` : ''})
        </span>
      )}
      <span className="font-mono text-[11px] text-ink-400">{profileUrl}</span>
    </div>
  )
}

function Members({ s, canWrite, onOp }: { s: PatroniStatus; canWrite: boolean; onOp: (op: Op) => void }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-ink-800">Members</h2>
      <Table
        head={
          <tr>
            <th className="px-3 py-2">Member</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">State</th>
            <th className="px-3 py-2">PostgreSQL</th>
            <th className="px-3 py-2 text-right">Timeline</th>
            <th className="px-3 py-2 text-right">Lag</th>
            <th className="px-3 py-2">Tags</th>
            <th className="px-3 py-2">Flags</th>
            <th className="px-3 py-2"></th>
          </tr>
        }
      >
        {s.members.map((m) => {
          const leader = isLeader(m)
          const tags = Object.entries(m.tags).filter(([, v]) => v !== false && v !== null && v !== undefined && v !== '')
          return (
            <tr key={m.name} className="hover:bg-ink-50">
              <td className="px-3 py-2 font-mono text-xs">
                {m.name}
                {m.name === s.node.name && <span className="ml-1 text-ink-400">(queried)</span>}
              </td>
              <td className="px-3 py-2 text-xs">
                <Badge tone={roleTone(m)}>{m.role}</Badge>
              </td>
              <td className="px-3 py-2 text-xs">
                <Badge tone={stateTone(m.state)}>{m.state}</Badge>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{m.host ? `${m.host}:${m.port ?? ''}` : '—'}</td>
              <td className="px-3 py-2 text-right text-xs">{m.timeline ?? '—'}</td>
              <td className="px-3 py-2 text-right text-xs">
                {leader ? (
                  <span className="text-ink-400">—</span>
                ) : m.lag_unknown ? (
                  <Badge tone="warn">unknown</Badge>
                ) : (
                  <Badge tone={m.lag === null ? 'neutral' : m.lag >= 256 * 1024 * 1024 ? 'bad' : m.lag >= 16 * 1024 * 1024 ? 'warn' : 'ok'}>
                    {fmtBytes(m.lag)}
                  </Badge>
                )}
              </td>
              <td className="px-3 py-2 text-xs">
                <span className="inline-flex flex-wrap gap-1">
                  {tags.map(([k, v]) => (
                    <Badge key={k} tone={k === 'nofailover' || k === 'noloadbalance' ? 'warn' : 'neutral'}>
                      {v === true ? k : `${k}=${String(v)}`}
                    </Badge>
                  ))}
                </span>
              </td>
              <td className="px-3 py-2 text-xs">
                <span className="inline-flex flex-wrap gap-1">
                  {m.pending_restart && <Badge tone="warn">restart pending</Badge>}
                  {m.scheduled_restart && (
                    <Badge tone="warn">
                      restart scheduled{typeof m.scheduled_restart.schedule === 'string' ? ` ${fmtTime(m.scheduled_restart.schedule)}` : ''}
                    </Badge>
                  )}
                </span>
              </td>
              <td className="px-3 py-2 text-right">
                {canWrite && (
                  <span className="inline-flex gap-3 whitespace-nowrap">
                    <RowAction onClick={() => onOp({ kind: 'reload', member: m })}>Reload</RowAction>
                    <RowAction onClick={() => onOp({ kind: 'restart', member: m })}>
                      <RotateCw className="h-3.5 w-3.5" /> Restart
                    </RowAction>
                    {m.scheduled_restart && <RowAction onClick={() => onOp({ kind: 'cancel_restart', member: m })}>Cancel restart</RowAction>}
                    {!leader && (
                      <RowAction danger onClick={() => onOp({ kind: 'reinitialize', member: m })}>
                        Reinitialize
                      </RowAction>
                    )}
                  </span>
                )}
              </td>
            </tr>
          )
        })}
        {s.members.length === 0 && <EmptyRow colSpan={9}>Patroni reports no members.</EmptyRow>}
      </Table>
    </section>
  )
}

function RowAction({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button className={cx('inline-flex items-center gap-1 text-xs text-ink-500', danger ? 'hover:text-red-700' : 'hover:text-ink-900')} onClick={onClick}>
      {children}
    </button>
  )
}

function History({ s }: { s: PatroniStatus }) {
  const rows = [...s.history].reverse()
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-ink-800">Timeline history</h2>
      <Table
        head={
          <tr>
            <th className="px-3 py-2 text-right">Timeline</th>
            <th className="px-3 py-2">Ended at LSN</th>
            <th className="px-3 py-2">Reason</th>
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">New leader</th>
          </tr>
        }
      >
        {rows.map((h) => (
          <tr key={h.timeline} className="hover:bg-ink-50">
            <td className="px-3 py-2 text-right text-xs">{h.timeline}</td>
            <td className="px-3 py-2 font-mono text-xs">{h.lsn ?? '—'}</td>
            <td className="px-3 py-2 text-xs">{h.reason}</td>
            <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-600">{fmtTime(h.timestamp)}</td>
            <td className="px-3 py-2 font-mono text-xs">{h.new_leader ?? '—'}</td>
          </tr>
        ))}
        {rows.length === 0 && <EmptyRow colSpan={5}>No timeline switches yet — the cluster is still on its first timeline.</EmptyRow>}
      </Table>
    </section>
  )
}

function Config({ s }: { s: PatroniStatus }) {
  const c = s.config
  const pg = (c.postgresql ?? {}) as Record<string, unknown>
  const params = (pg.parameters ?? {}) as Record<string, unknown>
  const scalar: Array<[string, unknown]> = Object.entries(c).filter(([, v]) => typeof v !== 'object' || v === null)
  const pgScalar: Array<[string, unknown]> = Object.entries(pg).filter(([, v]) => typeof v !== 'object' || v === null)
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-ink-800">Dynamic configuration (DCS)</h2>
      <dl className="divide-y divide-ink-100 rounded-md border border-ink-200 bg-white text-sm">
        {scalar.map(([k, v]) => (
          <Row key={k} k={k} v={String(v)} hint={CONFIG_HINTS[k]} />
        ))}
        {pgScalar.map(([k, v]) => (
          <Row key={`pg.${k}`} k={`postgresql.${k}`} v={String(v)} />
        ))}
        {Object.entries(params).map(([k, v]) => (
          <Row key={`p.${k}`} k={`parameters.${k}`} v={String(v)} />
        ))}
        {scalar.length === 0 && pgScalar.length === 0 && <div className="px-3 py-2 text-ink-500">No dynamic configuration returned.</div>}
      </dl>
      <p className="mt-1 text-xs text-ink-500">
        Read-only view of <span className="font-mono">GET /config</span>. Change it with <span className="font-mono">patronictl edit-config</span>.
      </p>
    </section>
  )
}

const CONFIG_HINTS: Record<string, string> = {
  ttl: 'leader lock TTL (s)',
  loop_wait: 'HA loop interval (s)',
  retry_timeout: 'DCS/PostgreSQL retry timeout (s)',
  maximum_lag_on_failover: 'max lag (bytes) for a failover candidate',
  synchronous_mode: 'synchronous replication managed by Patroni',
  failsafe_mode: 'keep leader when DCS is unreachable',
}

function Row({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-1.5">
      <dt className="font-mono text-xs text-ink-600">
        {k}
        {hint && <span className="ml-2 font-sans text-ink-400">{hint}</span>}
      </dt>
      <dd className="text-right font-mono text-xs">{k === 'ttl' || k === 'loop_wait' || k === 'retry_timeout' ? fmtSeconds(Number(v)) : v}</dd>
    </div>
  )
}

function OperationModal({ op, s, profileId, onClose }: { op: Op; s: PatroniStatus; profileId: number; onClose: () => void }) {
  const qc = useQueryClient()
  const replicas = s.members.filter((m) => !isLeader(m))
  const [candidate, setCandidate] = useState('')
  const [when, setWhen] = useState('')
  const [pendingOnly, setPendingOnly] = useState(false)
  const [force, setForce] = useState(false)
  const [result, setResult] = useState<PatroniOperation | null>(null)
  const base = `/api/profiles/${profileId}/patroni`

  const run = useMutation({
    mutationFn: (): Promise<PatroniOperation> => {
      const at = when ? new Date(when).toISOString() : null
      switch (op.kind) {
        case 'switchover':
          return api.post(`${base}/switchover`, { candidate: candidate || null, scheduled_at: at })
        case 'failover':
          return api.post(`${base}/failover`, { candidate })
        case 'pause':
          return api.post(`${base}/pause`, { paused: op.paused })
        case 'restart':
          return api.post(`${base}/members/${encodeURIComponent(op.member.name)}/restart`, { pending_only: pendingOnly, schedule: at })
        case 'reinitialize':
          return api.post(`${base}/members/${encodeURIComponent(op.member.name)}/reinitialize`, { force })
        case 'reload':
          return api.post(`${base}/members/${encodeURIComponent(op.member.name)}/reload`)
        case 'cancel_switchover':
          return api.delete(`${base}/switchover`)
        case 'cancel_restart':
          return api.delete(`${base}/members/${encodeURIComponent(op.member.name)}/restart`)
      }
    },
    onSuccess: (r) => {
      setResult(r)
      qc.invalidateQueries({ queryKey: ['profile', profileId, 'patroni'] })
      qc.invalidateQueries({ queryKey: ['audit'] })
    },
  })

  const title: Record<Op['kind'], string> = {
    switchover: 'Switchover',
    failover: 'Failover',
    pause: op.kind === 'pause' && op.paused ? 'Pause cluster management' : 'Resume cluster management',
    restart: `Restart PostgreSQL · ${'member' in op ? op.member.name : ''}`,
    reinitialize: `Reinitialize · ${'member' in op ? op.member.name : ''}`,
    reload: `Reload configuration · ${'member' in op ? op.member.name : ''}`,
    cancel_switchover: 'Cancel scheduled switchover',
    cancel_restart: `Cancel scheduled restart · ${'member' in op ? op.member.name : ''}`,
  }
  const needsCandidate = op.kind === 'failover'
  const danger = op.kind === 'failover' || op.kind === 'reinitialize' || op.kind === 'restart' || (op.kind === 'pause' && op.paused)

  return (
    <Modal title={title[op.kind]} onClose={onClose}>
      <div className="space-y-4">
        {!result && (
          <>
            {op.kind === 'switchover' && (
              <>
                <p className="text-sm text-ink-700">
                  Patroni demotes the current leader <b className="font-mono text-xs">{s.leader}</b> cleanly and promotes a healthy replica. Clients are
                  disconnected during the switch; the old leader rejoins as a replica (pg_rewind if enabled).
                </p>
                <Field label="Candidate" hint="Leave on “best replica” to let Patroni pick the healthiest member.">
                  <Select value={candidate} onChange={(e) => setCandidate(e.target.value)}>
                    <option value="">best replica</option>
                    {replicas.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name} ({m.state}
                        {m.lag !== null ? `, lag ${fmtBytes(m.lag)}` : ''})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Schedule (optional)" hint="Local time. Leave empty to switch over now.">
                  <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                </Field>
              </>
            )}
            {op.kind === 'failover' && (
              <>
                <Alert tone="error">
                  Failover promotes the candidate immediately without waiting for it to catch up. Use it when the leader is gone; prefer a switchover on a
                  healthy cluster.
                </Alert>
                <Field label="Candidate">
                  <Select value={candidate} onChange={(e) => setCandidate(e.target.value)}>
                    <option value="">choose a member…</option>
                    {replicas.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name} ({m.state}
                        {m.lag !== null ? `, lag ${fmtBytes(m.lag)}` : ''})
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
            {op.kind === 'pause' && (
              <p className="text-sm text-ink-700">
                {op.paused
                  ? 'While paused, Patroni stops managing PostgreSQL: no automatic failover, no restarts, no configuration enforcement. Use it for manual maintenance and remember to resume.'
                  : 'Patroni resumes automatic management of the cluster. If PostgreSQL state diverged during the pause, Patroni reconciles it.'}
              </p>
            )}
            {op.kind === 'restart' && (
              <>
                <p className="text-sm text-ink-700">
                  Restarts PostgreSQL on <b className="font-mono text-xs">{op.member.name}</b>
                  {isLeader(op.member) ? ' — this is the leader; all clients will be disconnected.' : '; clients connected to this replica are disconnected.'}
                </p>
                <Checkbox label="Only if a restart is pending (parameter changes that need one)" checked={pendingOnly} onChange={setPendingOnly} />
                <Field label="Schedule (optional)" hint="Local time. Leave empty to restart now.">
                  <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                </Field>
              </>
            )}
            {op.kind === 'reinitialize' && (
              <>
                <Alert tone="error">
                  The data directory of <b className="font-mono text-xs">{op.member.name}</b> is removed and re-cloned from the leader. The member is
                  unavailable until the copy completes.
                </Alert>
                <Checkbox label="Force (even if PostgreSQL is running on the member)" checked={force} onChange={setForce} />
              </>
            )}
            {op.kind === 'reload' && (
              <p className="text-sm text-ink-700">
                Patroni re-reads its local configuration on <b className="font-mono text-xs">{op.member.name}</b> and asks PostgreSQL to reload (SIGHUP). No
                restart, no disconnections.
              </p>
            )}
            {op.kind === 'cancel_switchover' && <p className="text-sm text-ink-700">Removes the scheduled switchover; the current leader stays.</p>}
            {op.kind === 'cancel_restart' && (
              <p className="text-sm text-ink-700">
                Removes the scheduled restart on <b className="font-mono text-xs">{op.member.name}</b>.
              </p>
            )}
          </>
        )}
        {run.error && <Alert tone="error">{run.error.message}</Alert>}
        {result && (
          <Alert tone="ok">
            Patroni: {result.message}. Recorded in the{' '}
            <Link to="/security/audit" className="underline">
              audit log
            </Link>
            .
          </Alert>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button variant={danger ? 'danger' : 'primary'} onClick={() => run.mutate()} disabled={run.isPending || (needsCandidate && !candidate)}>
              {run.isPending ? 'Running…' : title[op.kind]}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
