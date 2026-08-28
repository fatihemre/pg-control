import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { NoInstance, QueryState } from '../components/QueryState'
import { Alert, Badge, Button, EmptyRow, PageHeader, Table } from '../components/ui'
import { hbaQuery, type HbaRule } from '../lib/catalog'
import { useBasket } from '../lib/changes'
import { useInstance } from '../lib/instance'

const WEAK = new Set(['trust', 'password'])

function methodTone(m: string | null) {
  if (!m) return 'neutral' as const
  if (WEAK.has(m)) return 'bad' as const
  if (m === 'md5') return 'warn' as const
  return 'ok' as const
}

function list(v: string[] | null) {
  return v?.join(', ') ?? ''
}

export function ClientAuthPage() {
  const { current } = useInstance()
  const basket = useBasket()
  const hba = useQuery({ ...hbaQuery(current?.id ?? 0), enabled: !!current })
  const rows = hba.data?.rows ?? []
  const errors = rows.filter((r) => r.error)
  const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])
  const risky = rows.filter((r) => r.auth_method && WEAK.has(r.auth_method) && r.type !== 'local' && !(r.address && LOOPBACK.has(r.address)))

  return (
    <>
      <PageHeader
        title="Client authentication (pg_hba.conf)"
        actions={
          <Button variant="secondary" className="whitespace-nowrap" onClick={() => basket.add({ op: 'reload_conf' }, null)}>
            <RefreshCw className="h-4 w-4" /> Reload config
          </Button>
        }
      />
      <p className="mb-4 text-sm text-ink-600">
        Rules as PostgreSQL currently parses the file (<span className="font-mono">pg_hba_file_rules</span>). Rules are matched top-down; the first match wins.
        The file itself must be edited on the server, then reloaded.
      </p>
      {!current ? (
        <NoInstance />
      ) : hba.isSuccess ? (
        <>
          {!hba.data.readable && <Alert tone="error">The connected role may not read pg_hba_file_rules (needs superuser or pg_read_all_settings).</Alert>}
          {errors.length > 0 && (
            <div className="mb-3">
              <Alert tone="error">{errors.length} line(s) could not be parsed — those rules are ignored and a reload will fail.</Alert>
            </div>
          )}
          {risky.length > 0 && (
            <div className="mb-3">
              <Alert tone="error">{risky.length} non-loopback network rule(s) use trust/password authentication (no or cleartext passwords).</Alert>
            </div>
          )}
          <Table
            head={
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Line</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Database</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Address</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Options</th>
              </tr>
            }
          >
            {rows.map((r, i) => (
              <Row key={i} r={r} i={i} />
            ))}
            {rows.length === 0 && <EmptyRow colSpan={8}>No rules.</EmptyRow>}
          </Table>
          {rows[0]?.file_name && <p className="mt-2 font-mono text-xs text-ink-500">{rows[0].file_name}</p>}
        </>
      ) : (
        <QueryState query={hba} />
      )}
    </>
  )
}

function Row({ r, i }: { r: HbaRule; i: number }) {
  if (r.error) {
    return (
      <tr className="bg-red-50">
        <td className="px-3 py-2 text-xs text-ink-500">{r.rule_number ?? i + 1}</td>
        <td className="px-3 py-2 font-mono text-xs">{r.line_number}</td>
        <td colSpan={6} className="px-3 py-2 text-xs text-red-800">
          {r.error}
        </td>
      </tr>
    )
  }
  return (
    <tr className="hover:bg-ink-50">
      <td className="px-3 py-2 text-xs text-ink-500">{r.rule_number ?? i + 1}</td>
      <td className="px-3 py-2 font-mono text-xs">{r.line_number}</td>
      <td className="px-3 py-2 font-mono text-xs">{r.type}</td>
      <td className="px-3 py-2 font-mono text-xs">{list(r.database)}</td>
      <td className="px-3 py-2 font-mono text-xs">{list(r.user_name)}</td>
      <td className="px-3 py-2 font-mono text-xs">
        {r.address ?? ''}
        {r.netmask && <span className="text-ink-400"> / {r.netmask}</span>}
      </td>
      <td className="px-3 py-2">
        <Badge tone={methodTone(r.auth_method)}>{r.auth_method}</Badge>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-ink-600">{list(r.options)}</td>
    </tr>
  )
}
