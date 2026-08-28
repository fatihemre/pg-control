import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import { QueryState } from '../components/QueryState'
import { Badge, Checkbox, EmptyRow, PageHeader, Table } from '../components/ui'
import { cx } from '../lib/cx'
import { auditQuery } from '../lib/catalog'
import { useInstance } from '../lib/instance'

export function AuditPage() {
  const { current } = useInstance()
  const [onlyCurrent, setOnlyCurrent] = useState(true)
  const query = useQuery(auditQuery(onlyCurrent && current ? current.id : undefined))
  const [open, setOpen] = useState<number | null>(null)

  return (
    <>
      <PageHeader
        title="Audit log"
        actions={<Checkbox label={`Only ${current?.name ?? 'current instance'}`} checked={onlyCurrent} onChange={setOnlyCurrent} />}
      />
      {query.isSuccess ? (
        <Table
          head={
            <tr>
              <th className="w-6 px-2 py-2"></th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Instance</th>
              <th className="px-3 py-2">Database</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Summary</th>
            </tr>
          }
        >
          {query.data.map((e) => {
            const isOpen = open === e.id
            const d = e.detail ?? {}
            return (
              <Fragment key={e.id}>
                <tr className="cursor-pointer hover:bg-ink-50" onClick={() => setOpen(isOpen ? null : e.id)}>
                  <td className="px-2 py-2 text-ink-400">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                  <td className="px-3 py-2 font-mono text-xs">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2">{e.user ?? '—'}</td>
                  <td className="px-3 py-2">{e.profile ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{d.database ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge
                      tone={
                        e.action.endsWith('_failed') || e.action === 'login_locked' ? 'bad' : e.action === 'apply' || e.action === 'patroni' ? 'ok' : 'neutral'
                      }
                    >
                      {e.action}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-700">
                    {d.descriptions?.length ? `${d.descriptions.length} statement(s): ${d.descriptions[0]}${d.descriptions.length > 1 ? ', …' : ''}` : ''}
                    {d.error && <span className="text-red-700"> — {d.error}</span>}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-ink-50/60">
                    <td></td>
                    <td colSpan={6} className="px-3 py-3">
                      <ol className="space-y-1">
                        {(d.statements ?? []).map((s, i) => (
                          <li
                            key={i}
                            className={cx(
                              'rounded border px-2 py-1 font-mono text-xs',
                              d.failed_index === i ? 'border-red-300 bg-red-50' : 'border-ink-200 bg-white',
                            )}
                          >
                            {s};
                          </li>
                        ))}
                      </ol>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
          {query.data.length === 0 && <EmptyRow colSpan={7}>No entries yet.</EmptyRow>}
        </Table>
      ) : (
        <QueryState query={query} />
      )}
    </>
  )
}
