export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  const units = ['B', 'kB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

export function fmtNum(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString()
}

export function fmtPct(r: number | null | undefined, digits = 1): string {
  return r === null || r === undefined ? '—' : `${(r * 100).toFixed(digits)}%`
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 2 : 1)} ms`
  return fmtSeconds(ms / 1000)
}

export function fmtSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined) return '—'
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

export function truncate(s: string | null | undefined, n = 100): string {
  if (!s) return ''
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n)}…` : one
}
