import { useQuery } from '@tanstack/react-query'
import { Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DatabasePicker } from '../components/DatabasePicker'
import { NoInstance, QueryState } from '../components/QueryState'
import { Badge, Checkbox, EmptyRow, Input, PageHeader, Select, Table, cx } from '../components/ui'
import { indexStatsQuery, schemasQuery, tableStatsQuery, type IndexStats, type TableStats } from '../lib/catalog'
import { useBasket } from '../lib/changes'
import { useDatabase, useInstance } from '../lib/instance'
import { fmtBytes, fmtNum, fmtPct, fmtTime } from '../lib/format'

type Tab = 'tables' | 'indexes'
type Hint = { label: string; tone: 'warn' | 'bad' }

function later(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

function tableHints(t: TableStats): Hint[] {
  const out: Hint[] = []
  if ((t.dead_ratio ?? 0) >= 0.2 && t.n_dead_tup >= 1000) out.push({ label: 'bloat', tone: 'warn' })
  if (t.n_live_tup >= 10000 && t.seq_scan > (t.idx_scan ?? 0) && t.seq_scan > 100) out.push({ label: 'seq scans', tone: 'warn' })
  if (!t.last_analyze && !t.last_autoanalyze && t.n_live_tup > 0) out.push({ label: 'never analyzed', tone: 'warn' })
  if (t.cache_hit_ratio !== null && t.cache_hit_ratio < 0.9 && t.heap_blks_read > 1000) out.push({ label: 'low cache hit', tone: 'warn' })
  return out
}

function indexHints(i: IndexStats): Hint[] {
  const out: Hint[] = []
  if (!i.is_valid) out.push({ label: 'invalid', tone: 'bad' })
  if (i.idx_scan === 0 && !i.is_primary && !i.is_unique) out.push({ label: 'unused', tone: 'warn' })
  return out
}

export function TableStatsPage() {
  const { current } = useInstance()
  const { db, profileId } = useDatabase()
  const [tab, setTab] = useState<Tab>('tables')
  const [schema, setSchema] = useState('')
  const [search, setSearch] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const schemas = useQuery({ ...schemasQuery(profileId, db), enabled: !!current && !!db })
  const tables = useQuery({ ...tableStatsQuery(profileId, db, schema || undefined), enabled: !!current && !!db && tab === 'tables' })
  const indexes = useQuery({ ...indexStatsQuery(profileId, db, schema || undefined), enabled: !!current && !!db && tab === 'indexes' })

  return (
    <>
      <PageHeader
        title="Tables & indexes"
        actions={
          <div className="flex items-center gap-3">
            <DatabasePicker />
            <Select className="w-44" value={schema} onChange={(e) => setSchema(e.target.value)}>
              <option value="">All schemas</option>
              {(schemas.data ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Input className="w-48" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <span className="whitespace-nowrap">
              <Checkbox label="Flagged only" checked={flaggedOnly} onChange={setFlaggedOnly} />
            </span>
          </div>
        }
      />
      <div className="mb-4 flex gap-1 border-b border-ink-200">
        {(['tables', 'indexes'] as Tab[]).map((t) => (
          <button
            key={t}
            className={cx(
              '-mb-px border-b-2 px-3 py-1.5 text-sm capitalize',
              tab === t ? 'border-accent-600 font-medium text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-800',
            )}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {!current ? (
        <NoInstance />
      ) : tab === 'tables' ? (
        tables.isSuccess ? (
          <TablesView rows={tables.data} db={db} search={search} flaggedOnly={flaggedOnly} />
        ) : (
          <QueryState query={tables} />
        )
      ) : indexes.isSuccess ? (
        <IndexesView rows={indexes.data} search={search} flaggedOnly={flaggedOnly} />
      ) : (
        <QueryState query={indexes} />
      )}
    </>
  )
}

function TablesView({ rows, db, search, flaggedOnly }: { rows: TableStats[]; db: string; search: string; flaggedOnly: boolean }) {
  const basket = useBasket()
  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((t) => (!q || `${t.schema}.${t.name}`.toLowerCase().includes(q)) && (!flaggedOnly || tableHints(t).length > 0))
  }, [rows, search, flaggedOnly])
  return (
    <div className="space-y-3">
      <Table
        head={
          <tr>
            <th className="px-3 py-2">Table</th>
            <th className="px-3 py-2 text-right">Size</th>
            <th className="px-3 py-2 text-right">Live rows</th>
            <th className="px-3 py-2 text-right">Dead rows</th>
            <th className="px-3 py-2 text-right">Seq / idx scans</th>
            <th className="px-3 py-2 text-right">Cache hit</th>
            <th className="px-3 py-2">Last vacuum</th>
            <th className="px-3 py-2">Last analyze</th>
            <th className="px-3 py-2"></th>
          </tr>
        }
      >
        {list.map((t) => {
          const hints = tableHints(t)
          return (
            <tr key={`${t.schema}.${t.name}`} className="hover:bg-ink-50">
              <td className="px-3 py-2 font-mono text-xs">
                {t.schema}.{t.name}
                {t.kind !== 'table' && <span className="ml-1 text-ink-400">({t.kind})</span>}
                {hints.map((h) => (
                  <span key={h.label} className="ml-1">
                    <Badge tone={h.tone}>{h.label}</Badge>
                  </span>
                ))}
              </td>
              <td
                className="px-3 py-2 text-right text-xs"
                title={`table ${fmtBytes(t.table_bytes)} · indexes ${fmtBytes(t.index_bytes)} · toast ${fmtBytes(t.toast_bytes)}`}
              >
                {fmtBytes(t.total_bytes)}
              </td>
              <td className="px-3 py-2 text-right text-xs">{fmtNum(t.n_live_tup)}</td>
              <td className="px-3 py-2 text-right text-xs">
                {fmtNum(t.n_dead_tup)}
                {t.dead_ratio !== null && t.n_dead_tup > 0 && <span className="ml-1 text-ink-400">({fmtPct(t.dead_ratio, 0)})</span>}
              </td>
              <td className="px-3 py-2 text-right text-xs">
                {fmtNum(t.seq_scan)} / {fmtNum(t.idx_scan)}
              </td>
              <td className="px-3 py-2 text-right text-xs">{fmtPct(t.cache_hit_ratio)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-600" title={`manual: ${fmtTime(t.last_vacuum)} · auto: ${fmtTime(t.last_autovacuum)}`}>
                {fmtTime(later(t.last_vacuum, t.last_autovacuum))}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-600" title={`manual: ${fmtTime(t.last_analyze)} · auto: ${fmtTime(t.last_autoanalyze)}`}>
                {fmtTime(later(t.last_analyze, t.last_autoanalyze))}
              </td>
              <td className="px-3 py-2 text-right">
                <span className="inline-flex gap-3 whitespace-nowrap">
                  <button
                    className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-accent-700"
                    onClick={() => basket.add({ op: 'analyze', schema: t.schema, name: t.name }, db)}
                  >
                    <Wrench className="h-3.5 w-3.5" /> Analyze
                  </button>
                  <button
                    className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-accent-700"
                    onClick={() => basket.add({ op: 'vacuum', schema: t.schema, name: t.name, analyze: true }, db)}
                  >
                    <Wrench className="h-3.5 w-3.5" /> Vacuum analyze
                  </button>
                </span>
              </td>
            </tr>
          )
        })}
        {list.length === 0 && <EmptyRow colSpan={9}>No tables match.</EmptyRow>}
      </Table>
      <p className="text-xs text-ink-500">
        Flags: <b>bloat</b> ≥ 20% dead rows (≥ 1 000), <b>seq scans</b> more sequential than index scans on a ≥ 10 000-row table, <b>never analyzed</b>,{' '}
        <b>low cache hit</b> &lt; 90% heap hits. VACUUM runs outside a transaction; VACUUM FULL is intentionally not offered here.
      </p>
    </div>
  )
}

function IndexesView({ rows, search, flaggedOnly }: { rows: IndexStats[]; search: string; flaggedOnly: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((i) => (!q || `${i.schema}.${i.table} ${i.name}`.toLowerCase().includes(q)) && (!flaggedOnly || indexHints(i).length > 0))
  }, [rows, search, flaggedOnly])
  const unusedBytes = rows.filter((i) => indexHints(i).some((h) => h.label === 'unused')).reduce((n, i) => n + i.size_bytes, 0)
  return (
    <div className="space-y-3">
      {unusedBytes > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {fmtBytes(unusedBytes)} in indexes that have never been scanned since the last statistics reset. Check they are not needed for constraints or rare
          reports before dropping.
        </div>
      )}
      <Table
        head={
          <tr>
            <th className="px-3 py-2">Index</th>
            <th className="px-3 py-2">Table</th>
            <th className="px-3 py-2 text-right">Size</th>
            <th className="px-3 py-2 text-right">Scans</th>
            <th className="px-3 py-2 text-right">Tuples read / fetched</th>
            <th className="px-3 py-2">Flags</th>
          </tr>
        }
      >
        {list.map((i) => {
          const key = `${i.schema}.${i.name}`
          return (
            <tr key={key} className="hover:bg-ink-50">
              <td className="cursor-pointer px-3 py-2 font-mono text-xs" onClick={() => setExpanded(expanded === key ? null : key)} title="Click for definition">
                {i.name}
                {expanded === key && <pre className="mt-1 whitespace-pre-wrap text-[11px] text-ink-600">{i.definition}</pre>}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-ink-600">
                {i.schema}.{i.table}
              </td>
              <td className="px-3 py-2 text-right text-xs">{fmtBytes(i.size_bytes)}</td>
              <td className="px-3 py-2 text-right text-xs">{fmtNum(i.idx_scan)}</td>
              <td className="px-3 py-2 text-right text-xs">
                {fmtNum(i.idx_tup_read)} / {fmtNum(i.idx_tup_fetch)}
              </td>
              <td className="px-3 py-2 text-xs">
                <span className="inline-flex gap-1">
                  {i.is_primary && <Badge>primary</Badge>}
                  {i.is_unique && !i.is_primary && <Badge>unique</Badge>}
                  {indexHints(i).map((h) => (
                    <Badge key={h.label} tone={h.tone}>
                      {h.label}
                    </Badge>
                  ))}
                </span>
              </td>
            </tr>
          )
        })}
        {list.length === 0 && <EmptyRow colSpan={6}>No indexes match.</EmptyRow>}
      </Table>
    </div>
  )
}
