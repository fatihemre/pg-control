import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { NoInstance, QueryState } from '../components/QueryState'
import { Badge, Button, EmptyRow, PageHeader, Table } from '../components/ui'
import { cx } from '../lib/cx'
import { dbStatsQuery } from '../lib/catalog'
import { useInstance } from '../lib/instance'
import { fmtBytes, fmtNum, fmtPct, fmtTime } from '../lib/format'

export function DatabaseStatsPage() {
  const { current } = useInstance()
  const stats = useQuery({ ...dbStatsQuery(current?.id ?? 0), enabled: !!current })
  return (
    <>
      <PageHeader
        title="Databases"
        actions={
          <Button variant="secondary" onClick={() => stats.refetch()} disabled={stats.isFetching}>
            <RefreshCw className={cx('h-4 w-4', stats.isFetching && 'animate-spin')} /> Refresh
          </Button>
        }
      />
      {!current ? (
        <NoInstance />
      ) : stats.isSuccess ? (
        <div className="space-y-3">
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Database</th>
                <th className="px-3 py-2 text-right">Size</th>
                <th className="px-3 py-2 text-right">Backends</th>
                <th className="px-3 py-2 text-right">Commits</th>
                <th className="px-3 py-2 text-right">Rollbacks</th>
                <th className="px-3 py-2 text-right">Cache hit</th>
                <th className="px-3 py-2 text-right">Rows returned / fetched</th>
                <th className="px-3 py-2 text-right">Ins / upd / del</th>
                <th className="px-3 py-2 text-right">Temp files</th>
                <th className="px-3 py-2 text-right">Deadlocks</th>
                <th className="px-3 py-2 text-right">Conflicts</th>
                <th className="px-3 py-2">Stats reset</th>
              </tr>
            }
          >
            {stats.data.map((d) => {
              const tx = d.xact_commit + d.xact_rollback
              const rollbackRatio = tx > 0 ? d.xact_rollback / tx : 0
              return (
                <tr key={d.name} className="hover:bg-ink-50">
                  <td className="px-3 py-2 font-mono text-xs">{d.name}</td>
                  <td className="px-3 py-2 text-right text-xs">{fmtBytes(d.size_bytes)}</td>
                  <td className="px-3 py-2 text-right text-xs">{d.numbackends}</td>
                  <td className="px-3 py-2 text-right text-xs">{fmtNum(d.xact_commit)}</td>
                  <td className="px-3 py-2 text-right text-xs">
                    {fmtNum(d.xact_rollback)}
                    {rollbackRatio > 0.1 && tx > 100 && (
                      <span className="ml-1">
                        <Badge tone="warn">{fmtPct(rollbackRatio, 0)}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {d.cache_hit_ratio !== null && d.cache_hit_ratio < 0.9 && d.blks_read > 10000 ? (
                      <Badge tone="warn">{fmtPct(d.cache_hit_ratio)}</Badge>
                    ) : (
                      fmtPct(d.cache_hit_ratio)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {fmtNum(d.tup_returned)} / {fmtNum(d.tup_fetched)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                    {fmtNum(d.tup_inserted)} / {fmtNum(d.tup_updated)} / {fmtNum(d.tup_deleted)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs" title={fmtBytes(d.temp_bytes)}>
                    {fmtNum(d.temp_files)}
                    {d.temp_bytes > 0 && <span className="ml-1 text-ink-400">({fmtBytes(d.temp_bytes)})</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">{d.deadlocks > 0 ? <Badge tone="bad">{d.deadlocks}</Badge> : 0}</td>
                  <td className="px-3 py-2 text-right text-xs">{d.conflicts}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-600">{fmtTime(d.stats_reset)}</td>
                </tr>
              )
            })}
            {stats.data.length === 0 && <EmptyRow colSpan={12}>No databases.</EmptyRow>}
          </Table>
          <p className="text-xs text-ink-500">
            Cumulative counters from pg_stat_database since the last statistics reset. Temp files indicate sorts or hashes spilling to disk (consider work_mem);
            deadlocks and a high rollback ratio usually point at application issues.
          </p>
        </div>
      ) : (
        <QueryState query={stats} />
      )}
    </>
  )
}
