import { Link, useLocation } from '@tanstack/react-router'
import { PageHeader } from '../components/ui'

export function NotFoundPage() {
  const { pathname } = useLocation()
  return (
    <div>
      <PageHeader title="Page not found" />
      <p className="text-sm text-ink-500">
        There is no page at <span className="font-mono">{pathname}</span>.{' '}
        <Link to="/connections" className="text-accent-700 underline">
          Back to instances
        </Link>
      </p>
    </div>
  )
}
