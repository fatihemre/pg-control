import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type Profile } from './api'

const STORAGE_KEY = 'pgcontrol.instance'

type InstanceContextValue = {
  profiles: Profile[]
  current: Profile | null
  select: (id: number) => void
  isLoading: boolean
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
    }),
    [profiles.data, profiles.isLoading, selected],
  )

  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>
}

export function useInstance(): InstanceContextValue {
  const ctx = useContext(InstanceContext)
  if (!ctx) throw new Error('useInstance outside InstanceProvider')
  return ctx
}
