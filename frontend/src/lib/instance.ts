import { useQuery } from '@tanstack/react-query'
import { createContext, useContext } from 'react'
import type { Profile } from './api'
import { databasesQuery } from './catalog'

export const INSTANCE_STORAGE_KEY = 'pgcontrol.instance'

export type InstanceContextValue = {
  profiles: Profile[]
  current: Profile | null
  select: (id: number) => void
  isLoading: boolean
  /** Database chosen for the current instance (may be stale until validated by useDatabase). */
  storedDatabase: string | null
  setDatabase: (db: string) => void
}

export const InstanceContext = createContext<InstanceContextValue | null>(null)

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
