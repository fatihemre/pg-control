import { useQuery } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { api, type Profile } from '../lib/api'
import { INSTANCE_STORAGE_KEY as KEY, InstanceContext, type InstanceContextValue } from '../lib/instance'

function readStored(): number | null {
  try {
    const v = localStorage.getItem(KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

function readStoredDatabase(profileId: number | null): string | null {
  if (profileId === null) return null
  try {
    return localStorage.getItem(`${KEY}.${profileId}.db`)
  } catch {
    return null
  }
}

/** Selected instance (and per-instance database), remembered in localStorage. */
export function InstanceProvider({ children }: { children: ReactNode }) {
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => api.get<Profile[]>('/api/profiles') })
  const [chosen, setChosen] = useState<number | null>(readStored)
  const [databases, setDatabases] = useState<Record<number, string | null>>({})

  // Fall back to the first profile when nothing (or a deleted profile) is remembered.
  const list = useMemo(() => profiles.data ?? [], [profiles.data])
  const selected = chosen !== null && list.some((p) => p.id === chosen) ? chosen : (list[0]?.id ?? null)
  const storedDatabase = selected === null ? null : selected in databases ? databases[selected] : readStoredDatabase(selected)

  const value = useMemo<InstanceContextValue>(
    () => ({
      profiles: list,
      current: list.find((p) => p.id === selected) ?? null,
      select: (id) => {
        setChosen(id)
        try {
          localStorage.setItem(KEY, String(id))
        } catch {
          /* ignore */
        }
      },
      isLoading: profiles.isLoading,
      storedDatabase,
      setDatabase: (db) => {
        if (selected === null) return
        setDatabases((d) => ({ ...d, [selected]: db }))
        try {
          localStorage.setItem(`${KEY}.${selected}.db`, db)
        } catch {
          /* ignore */
        }
      },
    }),
    [list, profiles.isLoading, selected, storedDatabase],
  )

  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>
}
