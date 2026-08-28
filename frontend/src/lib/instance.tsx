import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type Profile } from './api'
import { databasesQuery } from './catalog'

const STORAGE_KEY = 'pgcontrol.instance'

type InstanceContextValue = {
  profiles: Profile[]
  current: Profile | null
  select: (id: number) => void
  isLoading: boolean
  /** Database chosen for the current instance (may be stale until validated by useDatabase). */
  storedDatabase: string | null
  setDatabase: (db: string) => void
}

const InstanceContext = createContext<InstanceContextValue | null>(null)

function readStored(): number | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export function InstanceProvider({ children }: { children: ReactNode }) {
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => api.get<Profile[]>('/api/profiles') })
  const [selected, setSelected] = useState<number | null>(readStored)
  const [storedDatabase, setStoredDatabase] = useState<string | null>(null)

  useEffect(() => {
    try {
      setStoredDatabase(selected === null ? null : localStorage.getItem(`${STORAGE_KEY}.${selected}.db`))
    } catch {
      setStoredDatabase(null)
    }
  }, [selected])

  useEffect(() => {
    if (!profiles.data?.length) return
    if (selected === null || !profiles.data.some((p) => p.id === selected)) {
      setSelected(profiles.data[0].id)
    }
  }, [profiles.data, selected])

  const value = useMemo<InstanceContextValue>(
    () => ({
      profiles: profiles.data ?? [],
      current: profiles.data?.find((p) => p.id === selected) ?? null,
      select: (id) => {
        setSelected(id)
        try {
          localStorage.setItem(STORAGE_KEY, String(id))
        } catch {
          /* ignore */
        }
      },
      isLoading: profiles.isLoading,
      storedDatabase,
      setDatabase: (db) => {
        setStoredDatabase(db)
        try {
          localStorage.setItem(`${STORAGE_KEY}.${selected}.db`, db)
        } catch {
          /* ignore */
        }
      },
    }),
    [profiles.data, profiles.isLoading, selected, storedDatabase],
  )

  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>
}

export function useInstance(): InstanceContextValue {
  const ctx = useContext(InstanceContext)
  if (!ctx) throw new Error('useInstance outside InstanceProvider')
  return ctx
}

/** Current database for the selected instance, validated against the server's database list. */
export function useDatabase() {
  const { current, storedDatabase, setDatabase } = useInstance()
  const databases = useQuery({ ...databasesQuery(current?.id ?? 0), enabled: !!current })
  const list = databases.data ?? []
  const db = storedDatabase && list.includes(storedDatabase) ? storedDatabase : (list[0] ?? '')
  return { db, setDb: setDatabase, databases, profileId: current?.id ?? 0 }
}
