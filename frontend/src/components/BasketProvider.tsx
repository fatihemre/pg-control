import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { BasketContext, basketStorageKey, newPendingChange, readBasket, writeBasket, type BasketValue, type PendingChange } from '../lib/changes'
import { useInstance } from '../lib/instance'

/** Pending changes per instance, mirrored to sessionStorage so a reload keeps the basket. */
export function BasketProvider({ children }: { children: ReactNode }) {
  const { current } = useInstance()
  const key = basketStorageKey(current?.id)
  const [store, setStore] = useState<Record<string, PendingChange[]>>({})
  const [open, setOpen] = useState(false)
  const items = useMemo(() => store[key] ?? readBasket(key), [store, key])

  const persist = useCallback(
    (next: PendingChange[]) => {
      setStore((s) => ({ ...s, [key]: next }))
      writeBasket(key, next)
    },
    [key],
  )

  const value = useMemo<BasketValue>(
    () => ({
      items,
      add: (change, database) => persist([...items, newPendingChange(change, database)]),
      remove: (id) => persist(items.filter((i) => i.id !== id)),
      removeMany: (ids) => persist(items.filter((i) => !ids.includes(i.id))),
      clear: () => persist([]),
      open,
      setOpen,
    }),
    [items, open, persist],
  )
  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>
}
