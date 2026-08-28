import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { DatabasePicker } from '../components/DatabasePicker'
import { NoInstance, QueryState } from '../components/QueryState'
import { Alert, Badge, Button, EmptyRow, Modal, PageHeader, Select, Table, cx } from '../components/ui'
import { replicationQuery, type Replication, type Slot, type Standby } from '../lib/catalog'
import { useBasket } from '../lib/changes'
import { fmtBytes, fmtNum, fmtSeconds, fmtTime } from '../lib/format'
import { useDatabase, useInstance } from '../lib/instance'

const LAG_WARN = 16 * 1024 * 1024
const LAG_BAD = 256 * 1024 * 1024

function lagTone(bytes: number | null): 'ok' | 'warn' | 'bad' | 'neutral' {
  if (bytes === null) return 'neutral'
  return bytes >= LAG_BAD ? 'bad' : bytes >= LAG_WARN ? 'warn' : 'ok'
}

export function ReplicationPage() {
  const { current } = useInstance()
  const { db } = useDatabase()
  const [every, setEvery] = useState(5000)
  const repl = useQuery({
    ...replicationQuery(current?.id ?? 0, db),
    enabled: !!current && !!db,
    refetchInterval: every || false,
  })
  const [dropping, setDropping] = useState<Slot | null>(null)
  const r = repl.data

  return (
    <>
      <PageHeader
        title="Replication"
        actions={
          <div className="flex items-center gap-3">
            <Select className="w-40" value={every} onChange={(e) => setEvery(Number(e.target.value))}>
              <option value={0}>No auto-refresh</option>
              <option value={2000}>Every 2 s</option>
              <option value={5000}>Every 5 s</option>
              <option value={15000}>Every 15 s</option>
            </Select>
            <Button variant="secondary" onClick={() => repl.refetch()} disabled={repl.isFetching}>
              <RefreshCw className={cx('h-4 w-4', repl.isFetching && 'animate-spin')} /> Refresh
            </Button>
          </div>
        }
      />
      {!current ? (
        <NoInstance />
      ) : r ? (
        <div className="space-y-6">
          <Summary r={r} />
          {r.in_recovery ? <StandbyView r={r} /> : <Standbys standbys={r.standbys} />}
          <Slots slots={r.slots} onDrop={setDropping} />
          <Logical r={r} />
        </div>
      ) : (
        <QueryState query={repl} />
      )}
      {dropping && <DropSlot slot={dropping} onClose={() => setDropping(null)} />}
    </>
  )
}

function Summary({ r }: { r: Replication }) {
  const inactive = r.slots.filter((s) => !s.active).length
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-700">
      <Badge tone={r.in_recovery ? 'warn' : 'ok'}>{r.in_recovery ? 'standby (in recovery)' : 'primary'}</Badge>
      <span>
        wal_level <b className="font-mono text-xs">{r.wal_level}</b>
      </span>
      <span>
        wal senders <b>{r.standbys.length}</b> / {r.max_wal_senders}
      </span>
      <span>
        slots <b>{r.slots.length}</b> / {r.max_replication_slots}
        {inactive > 0 && (
          <span className="ml-1">
            <Badge tone="warn">{inactive} inactive</Badge>
          </span>
        )}
      </span>
      {r.synchronous_standby_names && (
        <span>
          synchronous_standby_names <b className="font-mono text-xs">{r.synchronous_standby_names}</b>
        </span>
      )}
      {r.current_lsn && <span className="font-mono text-xs text-ink-500">LSN {r.current_lsn}</span>}
    </div>
  )
}

function Standbys({ standbys }: { standbys: Standby[] }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-ink-800">Connected standbys</h2>
      <Table
        head={
          <tr>
            <th className="px-3 py-2">Application</th>
            <th className="px-3 py-2">Client</th>
            <th className="px-3 py-2">State</th>
            <th className="px-3 py-2">Sync</th>
            <th className="px-3 py-2 text-right">Sent lag</th>
            <th className="px-3 py-2 text-right">Write lag</th>
            <th className="px-3 py-2 text-right">Flush lag</th>
            <th className="px-3 py-2 text-right">Replay lag</th>
            <th className="px-3 py-2">Replay LSN</th>
            <th className="px-3 py-2">Connected</th>
          </tr>
        }
      >
        {standbys.map((s) => (
          <tr key={s.pid} className="hover:bg-ink-50">
            <td className="px-3 py-2 font-mono text-xs">
              {s.application_name || <span className="text-ink-400">—</span>}
              <span className="ml-1 text-ink-400">pid {s.pid}</span>
            </td>
            <td className="px-3 py-2 font-mono text-xs">
              {s.client_addr ?? ''}
              {s.user && <span className="text-ink-400"> as {s.user}</span>}
            </td>
            <td className="px-3 py-2 text-xs">
              <Badge tone={s.state === 'streaming' ? 'ok' : 'warn'}>{s.state ?? '?'}</Badge>
            </td>
            <td className="px-3 py-2 text-xs">
              <Badge tone={s.sync_state === 'sync' ? 'ok' : 'neutral'}>{s.sync_state ?? '?'}</Badge>
            </td>
            <td className="px-3 py-2 text-right text-xs">{fmtBytes(s.sent_lag_bytes)}</td>
            <td className="px-3 py-2 text-right text-xs">
              {fmtBytes(s.write_lag_bytes)}
              {s.write_lag_seconds !== null && <span className="ml-1 text-ink-400">{fmtSeconds(s.write_lag_seconds)}</span>}
            </td>
            <td className="px-3 py-2 text-right text-xs">
              {fmtBytes(s.flush_lag_bytes)}
              {s.flush_lag_seconds !== null && <span className="ml-1 text-ink-400">{fmtSeconds(s.flush_lag_seconds)}</span>}
            </td>
            <td className="px-3 py-2 text-right text-xs">
              <Badge tone={lagTone(s.replay_lag_bytes)}>{fmtBytes(s.replay_lag_bytes)}</Badge>
              {s.replay_lag_seconds !== null && <span className="ml-1 text-ink-400">{fmtSeconds(s.replay_lag_seconds)}</span>}
            </td>
            <td className="px-3 py-2 font-mono text-xs">{s.replay_lsn ?? ''}</td>
            <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-600">{fmtTime(s.backend_start)}</td>
          </tr>
        ))}
        {standbys.length === 0 && <EmptyRow colSpan={10}>No standby is streaming from this instance.</EmptyRow>}
      </Table>
    </section>
  )
}

function StandbyView({ r }: { r: Replication }) {
  const rec = r.recovery
  const w = r.wal_receiver
  const rows: Array<[string, string]> = [
    ['WAL receiver', w ? `${w.status ?? '?'} (pid ${w.pid})` : 'not running'],
    ['Primary', w?.sender_host ? `${w.sender_host}:${w.sender_port}` : (rec.primary_conninfo ?? '—')],
    ['Slot', w?.slot_name ?? rec.primary_slot_name ?? '—'],
    ['Received LSN', rec.last_receive_lsn ?? '—'],
    ['Replayed LSN', rec.last_replay_lsn ?? '—'],
    [
      'Replay lag',
      rec.replay_lag_bytes === null
        ? '—'
        : `${fmtBytes(rec.replay_lag_bytes)}${rec.replay_delay_seconds ? ` · ${fmtSeconds(rec.replay_delay_seconds)} behind` : ''}`,
    ],
    ['Last replayed transaction', fmtTime(rec.last_replay_timestamp)],
    ['Last message from primary', fmtTime(w?.last_msg_receipt_time)],
    ['Timeline', w?.received_tli === null || w?.received_tli === undefined ? '—' : String(w.received_tli)],
    ['Replay paused', rec.is_paused === null ? '—' : rec.is_paused ? 'yes' : 'no'],
  ]
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-ink-800">Recovery status</h2>
      {rec.is_paused && <Alert tone="error">WAL replay is paused on this standby.</Alert>}
      {!w && <Alert tone="error">No WAL receiver process — this standby is not streaming from a primary.</Alert>}
      <dl className="mt-2 divide-y divide-ink-100 rounded-md border border-ink-200 bg-white text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 px-3 py-1.5">
            <dt className="text-ink-600">{k}</dt>
            <dd className="text-right font-mono text-xs">{v}</dd>
          </div>
        ))}
      </dl>
      {w?.conninfo && <p className="mt-1 font-mono text-[11px] text-ink-400">{w.conninfo}</p>}
    </section>
  )
}

function Slots({ slots, onDrop }: { slots: Slot[]; onDrop: (s: Slot) => void }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-ink-800">Replication slots</h2>
      <Table
        head={
          <tr>
            <th className="px-3 py-2">Slot</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Database / plugin</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Retained WAL</th>
            <th className="px-3 py-2">WAL status</th>
            <th className="px-3 py-2">Restart LSN</th>
            <th className="px-3 py-2">Confirmed flush</th>
            <th className="px-3 py-2">Flags</th>
            <th className="px-3 py-2"></th>
          </tr>
        }
      >
        {slots.map((s) => (
          <tr key={s.name} className="hover:bg-ink-50">
            <td className="px-3 py-2 font-mono text-xs">{s.name}</td>
            <td className="px-3 py-2 text-xs">{s.slot_type}</td>
            <td className="px-3 py-2 font-mono text-xs">
              {s.database ?? ''}
              {s.plugin && <span className="text-ink-400"> · {s.plugin}</span>}
            </td>
            <td className="px-3 py-2 text-xs">
              {s.active ? (
                <Badge tone="ok">active{s.active_pid ? ` · pid ${s.active_pid}` : ''}</Badge>
              ) : (
                <Badge tone="warn">
                  inactive
                  {s.inactive_since ? ` since ${fmtTime(s.inactive_since)}` : ''}
                </Badge>
              )}
            </td>
            <td className="px-3 py-2 text-right text-xs">
              <Badge tone={s.retained_bytes === null ? 'neutral' : s.active ? lagTone(s.retained_bytes) : s.retained_bytes >= LAG_WARN ? 'bad' : 'warn'}>
                {fmtBytes(s.retained_bytes)}
              </Badge>
            </td>
            <td className="px-3 py-2 text-xs">
              {s.wal_status && <Badge tone={s.wal_status === 'reserved' ? 'ok' : s.wal_status === 'extended' ? 'warn' : 'bad'}>{s.wal_status}</Badge>}
              {s.invalidation_reason && (
                <span className="ml-1">
                  <Badge tone="bad">{s.invalidation_reason}</Badge>
                </span>
              )}
              {s.safe_wal_size !== null && <span className="ml-1 text-ink-400">safe {fmtBytes(s.safe_wal_size)}</span>}
            </td>
            <td className="px-3 py-2 font-mono text-xs">{s.restart_lsn ?? ''}</td>
            <td className="px-3 py-2 font-mono text-xs">{s.confirmed_flush_lsn ?? ''}</td>
            <td className="px-3 py-2 text-xs">
              <span className="inline-flex flex-wrap gap-1">
                {s.temporary && <Badge>temporary</Badge>}
                {s.two_phase && <Badge>two-phase</Badge>}
                {s.failover && <Badge>failover</Badge>}
                {s.synced && <Badge>synced</Badge>}
                {s.conflicting && <Badge tone="bad">conflicting</Badge>}
              </span>
            </td>
            <td className="px-3 py-2 text-right">
              {!s.temporary && (
                <button className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-red-700" onClick={() => onDrop(s)}>
                  <Trash2 className="h-3.5 w-3.5" /> Drop
                </button>
              )}
            </td>
          </tr>
        ))}
        {slots.length === 0 && <EmptyRow colSpan={10}>No replication slots.</EmptyRow>}
      </Table>
    </section>
  )
}

function Logical({ r }: { r: Replication }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-ink-800">Logical replication</h2>
        <DatabasePicker />
      </div>
      <div className="grid grid-cols-2 gap-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-800">Publications</h2>
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Publication</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Operations</th>
                <th className="px-3 py-2">Tables</th>
              </tr>
            }
          >
            {r.publications.map((p) => (
              <tr key={p.name} className="hover:bg-ink-50">
                <td className="px-3 py-2 font-mono text-xs">{p.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{p.owner}</td>
                <td className="px-3 py-2 text-xs">
                  {(['insert', 'update', 'delete', 'truncate'] as const).filter((k) => p[k]).join(', ')}
                  {p.via_root && <span className="text-ink-400"> · via root</span>}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {p.all_tables ? <Badge>ALL TABLES</Badge> : p.tables.length ? p.tables.join(', ') : <span className="text-ink-400">none</span>}
                </td>
              </tr>
            ))}
            {r.publications.length === 0 && <EmptyRow colSpan={4}>No publications in {r.logical_database}.</EmptyRow>}
          </Table>
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-800">Subscriptions</h2>
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Subscription</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Publications</th>
                <th className="px-3 py-2">Received / applied</th>
                <th className="px-3 py-2 text-right">Errors</th>
              </tr>
            }
          >
            {r.subscriptions.map((s) => (
              <tr key={s.name} className="hover:bg-ink-50">
                <td className="px-3 py-2 font-mono text-xs">
                  {s.name}
                  {s.conninfo && <div className="text-[11px] text-ink-400">{s.conninfo}</div>}
                </td>
                <td className="px-3 py-2 text-xs">
                  {!s.enabled ? (
                    <Badge tone="warn">disabled</Badge>
                  ) : s.pid ? (
                    <Badge tone="ok">running · pid {s.pid}</Badge>
                  ) : (
                    <Badge tone="bad">worker not running</Badge>
                  )}
                  {s.tables_not_ready > 0 && (
                    <span className="ml-1">
                      <Badge tone="warn">{s.tables_not_ready} table(s) syncing</Badge>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{s.publications.join(', ')}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {s.received_lsn ?? '—'} / {s.latest_end_lsn ?? '—'}
                  <div className="text-[11px] text-ink-400">{fmtTime(s.last_msg_receipt_time)}</div>
                </td>
                <td className="px-3 py-2 text-right text-xs">
                  {(s.apply_error_count ?? 0) + (s.sync_error_count ?? 0) > 0 ? (
                    <Badge tone="bad">
                      {fmtNum(s.apply_error_count)} apply / {fmtNum(s.sync_error_count)} sync
                    </Badge>
                  ) : (
                    '0'
                  )}
                </td>
              </tr>
            ))}
            {r.subscriptions.length === 0 && <EmptyRow colSpan={5}>No subscriptions in {r.logical_database}.</EmptyRow>}
          </Table>
        </section>
      </div>
    </div>
  )
}

function DropSlot({ slot, onClose }: { slot: Slot; onClose: () => void }) {
  const basket = useBasket()
  return (
    <Modal title={`Drop replication slot · ${slot.name}`} onClose={onClose}>
      <div className="space-y-4">
        {slot.active ? (
          <Alert tone="error">This slot is in use (pid {slot.active_pid}). PostgreSQL refuses to drop an active slot; disconnect the consumer first.</Alert>
        ) : (
          <Alert tone="error">
            {slot.retained_bytes === null ? 'The slot has never been used, so no WAL is retained.' : `Dropping the slot releases ${fmtBytes(slot.retained_bytes)} of retained WAL.`} A
            standby or subscriber that still relies on it will need to be re-synchronised.
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={slot.active}
            onClick={() => {
              basket.add({ op: 'drop_replication_slot', name: slot.name }, null)
              onClose()
            }}
          >
            Add to pending changes
          </Button>
        </div>
      </div>
    </Modal>
  )
}
