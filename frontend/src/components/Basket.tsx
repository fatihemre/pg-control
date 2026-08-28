import { Loader2, ShoppingBasket, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useMe } from '../lib/auth'
import { groupByDatabase, useApply, useBasket, usePlan, type ApplyResult, type PlanResult } from '../lib/changes'
import { useInstance } from '../lib/instance'
import { Alert, Badge, Button, Modal } from './ui'
import { cx } from '../lib/cx'

type GroupResult = { database: string | null; plan?: PlanResult; error?: string; apply?: ApplyResult }

export function BasketButton() {
  const { items, setOpen } = useBasket()
  if (!items.length) return null
  return (
    <button
      className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-ink-950 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-ink-800"
      onClick={() => setOpen(true)}
    >
      <ShoppingBasket className="h-4 w-4" />
      {items.length} pending change{items.length === 1 ? '' : 's'}
    </button>
  )
}

export function BasketModal() {
  const { items, remove, removeMany, clear, open, setOpen } = useBasket()
  const { current } = useInstance()
  const me = useMe()
  const plan = usePlan(current?.id ?? 0)
  const apply = useApply(current?.id ?? 0)
  const [results, setResults] = useState<GroupResult[] | null>(null)
  const [stage, setStage] = useState<'edit' | 'preview' | 'done'>('edit')

  if (!open) return null
  const canApply = me.data?.role === 'admin' || me.data?.role === 'operator'
  const groups = groupByDatabase(items)

  const close = () => {
    setOpen(false)
    setStage('edit')
    setResults(null)
  }

  const preview = async () => {
    const out: GroupResult[] = []
    for (const g of groups) {
      try {
        out.push({ database: g.database, plan: await plan.mutateAsync({ database: g.database, operations: g.items.map((i) => i.change) }) })
      } catch (e) {
        out.push({ database: g.database, error: (e as Error).message })
      }
    }
    setResults(out)
    setStage('preview')
  }

  const run = async () => {
    const out: GroupResult[] = []
    const applied: string[] = []
    for (const g of groups) {
      try {
        const r = await apply.mutateAsync({ database: g.database, operations: g.items.map((i) => i.change) })
        out.push({ database: g.database, apply: r })
        if (r.ok) applied.push(...g.items.map((i) => i.id))
      } catch (e) {
        out.push({ database: g.database, error: (e as Error).message })
      }
    }
    removeMany(applied)
    setResults(out)
    setStage('done')
  }

  const busy = plan.isPending || apply.isPending

  return (
    <Modal title={`Pending changes · ${current?.name ?? ''}`} onClose={close} wide>
      {stage === 'edit' && (
        <div className="space-y-4">
          {items.length === 0 ? (
            <div className="text-sm text-ink-500">Nothing pending.</div>
          ) : (
            groups.map((g) => (
              <div key={g.database ?? '__default'}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{g.database ? `Database ${g.database}` : 'Cluster-wide'}</div>
                <ul className="divide-y divide-ink-100 rounded-md border border-ink-200">
                  {g.items.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 font-mono text-xs">
                      <span>{i.label}</span>
                      <button className="text-ink-400 hover:text-red-600" onClick={() => remove(i.id)} title="Remove">
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={clear} disabled={!items.length}>
              <Trash2 className="h-4 w-4" /> Clear all
            </Button>
            <Button onClick={preview} disabled={!items.length || busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Preview SQL
            </Button>
          </div>
        </div>
      )}

      {stage === 'preview' && results && (
        <div className="space-y-4">
          {results.map((r) => (
            <div key={r.database ?? '__default'}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{r.database ? `Database ${r.database}` : 'Cluster-wide'}</div>
              {r.error && <Alert tone="error">{r.error}</Alert>}
              {r.plan && <Statements statements={r.plan.statements} />}
              {r.plan?.warnings.map((w) => (
                <div key={w} className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {w}
                </div>
              ))}
            </div>
          ))}
          {!canApply && <Alert tone="error">Your PgControl role (viewer) cannot apply changes.</Alert>}
          {current?.read_only && <Alert tone="error">This instance is marked read-only in its connection profile.</Alert>}
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStage('edit')}>
              Back
            </Button>
            <Button onClick={run} disabled={busy || !canApply || !!current?.read_only || results.some((r) => r.error)}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Apply {results.reduce((n, r) => n + (r.plan?.statements.length ?? 0), 0)} statement(s)
            </Button>
          </div>
          <p className="text-xs text-ink-500">
            Each database group runs in a single transaction; a failing statement rolls the whole group back. Groups containing ALTER SYSTEM run statement by
            statement instead.
          </p>
        </div>
      )}

      {stage === 'done' && results && (
        <div className="space-y-4">
          {results.map((r) => (
            <div key={r.database ?? '__default'}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{r.database ? `Database ${r.database}` : 'Cluster-wide'}</div>
              {r.error && <Alert tone="error">{r.error}</Alert>}
              {r.apply && (
                <>
                  {r.apply.ok ? (
                    <Alert tone="ok">Applied {r.apply.executed} statement(s).</Alert>
                  ) : (
                    <Alert tone="error">
                      Rolled back: {r.apply.error} (statement {(r.apply.failed_index ?? 0) + 1})
                    </Alert>
                  )}
                  <div className="mt-2">
                    <Statements statements={r.apply.statements} failed={r.apply.failed_index ?? undefined} />
                  </div>
                </>
              )}
            </div>
          ))}
          <div className="flex justify-end">
            <Button onClick={close}>Close</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function Statements({ statements, failed }: { statements: { sql: string; description: string }[]; failed?: number }) {
  return (
    <ol className="space-y-1">
      {statements.map((s, i) => (
        <li key={i} className={cx('rounded-md border px-3 py-2', failed === i ? 'border-red-300 bg-red-50' : 'border-ink-200 bg-ink-50')}>
          <div className="mb-1 flex items-center gap-2 text-xs text-ink-500">
            <Badge>{i + 1}</Badge> {s.description}
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-ink-900">{s.sql};</pre>
        </li>
      ))}
    </ol>
  )
}
