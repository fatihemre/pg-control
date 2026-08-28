import { Link } from '@tanstack/react-router'
import { Server } from 'lucide-react'
import { Select } from './ui'
import { useInstance } from '../lib/instance'

export function InstancePicker() {
  const { profiles, current, select, isLoading } = useInstance()
  if (isLoading) return null
  if (!profiles.length) {
    return (
      <div className="text-sm text-ink-500">
        No instances configured.{' '}
        <Link to="/connections" className="text-accent-600 underline">
          Add one
        </Link>
      </div>
    )
  }
  return (
    <label className="flex items-center gap-2 text-sm">
      <Server className="h-4 w-4 text-ink-500" />
      <span className="text-ink-500">Instance</span>
      <Select className="w-56" value={current?.id ?? ''} onChange={(e) => select(Number(e.target.value))}>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
    </label>
  )
}
