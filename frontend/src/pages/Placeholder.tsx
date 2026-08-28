import { useLocation } from '@tanstack/react-router'
import { PageHeader } from '../components/ui'

export function PlaceholderPage() {
  const { pathname } = useLocation()
  return (
    <div>
      <PageHeader title="Coming soon" />
      <p className="text-sm text-ink-500">
        <span className="font-mono">{pathname}</span> is not implemented yet.
      </p>
    </div>
  )
}
