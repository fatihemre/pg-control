import type { UseQueryResult } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Alert } from './ui'

export function QueryState({ query }: { query: UseQueryResult<unknown> }) {
  if (query.isPending) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }
  if (query.isError) {
    return <Alert tone="error">{query.error.message}</Alert>
  }
  return null
}

export function NoInstance() {
  return <div className="rounded-md border border-dashed border-ink-300 p-8 text-center text-sm text-ink-500">Select an instance to continue.</div>
}
