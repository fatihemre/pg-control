import { Database } from 'lucide-react'
import { useDatabase } from '../lib/instance'
import { Select } from './ui'

export function DatabasePicker() {
  const { db, setDb, databases } = useDatabase()
  return (
    <label className="flex items-center gap-2 text-sm">
      <Database className="h-4 w-4 text-ink-500" />
      <span className="text-ink-500">Database</span>
      <Select className="w-48" value={db} onChange={(e) => setDb(e.target.value)} disabled={!databases.data}>
        {(databases.data ?? []).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </Select>
    </label>
  )
}
