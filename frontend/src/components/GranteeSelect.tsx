import { useQuery } from '@tanstack/react-query'
import { rolesQuery } from '../lib/catalog'
import { useInstance } from '../lib/instance'
import { Select } from './ui'

export function GranteeSelect({
  value,
  onChange,
  allowPublic = true,
  includeSystem = false,
  placeholder = 'Select a role…',
  exclude = [],
}: {
  value: string
  onChange: (v: string) => void
  allowPublic?: boolean
  includeSystem?: boolean
  placeholder?: string
  exclude?: string[]
}) {
  const { current } = useInstance()
  const roles = useQuery({ ...rolesQuery(current?.id ?? 0), enabled: !!current })
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {allowPublic && <option value="PUBLIC">PUBLIC (everyone)</option>}
      {(roles.data ?? [])
        .filter((r) => (includeSystem || !r.is_system) && !exclude.includes(r.name))
        .map((r) => (
          <option key={r.oid} value={r.name}>
            {r.name}
          </option>
        ))}
    </Select>
  )
}
