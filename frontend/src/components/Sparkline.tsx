import { useState } from 'react'

export type SparkPoint = { t: string; v: number | null }

/** Tiny dependency-free line chart. Null values break the line (stats reset / restart). */
export function Sparkline({
  points,
  format,
  width = 260,
  height = 56,
  tone = 'accent',
}: {
  points: SparkPoint[]
  format: (v: number) => string
  width?: number
  height?: number
  tone?: 'accent' | 'warn'
}) {
  const [hover, setHover] = useState<number | null>(null)
  const values = points.map((p) => p.v).filter((v): v is number => v !== null)
  if (values.length < 2) return <div className="flex h-14 items-center text-xs text-ink-400">Not enough samples yet.</div>
  const min = Math.min(0, ...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 2
  const x = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (width - pad * 2)
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2)
  let d = ''
  let pen = false
  points.forEach((p, i) => {
    if (p.v === null) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)} `
    pen = true
  })
  const stroke = tone === 'warn' ? '#d97706' : '#2563eb'
  const hp = hover !== null ? points[hover] : null
  return (
    <div className="relative">
      <svg
        width={width}
        height={height}
        className="block max-w-full"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const i = Math.round(((e.clientX - rect.left) / rect.width) * (points.length - 1))
          setHover(Math.max(0, Math.min(points.length - 1, i)))
        }}
      >
        <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {hp && hp.v !== null && <circle cx={x(hover!)} cy={y(hp.v)} r={3} fill={stroke} />}
      </svg>
      {hp && (
        <div className="pointer-events-none absolute -top-5 right-0 rounded bg-ink-950 px-1.5 py-0.5 font-mono text-[10px] text-white">
          {new Date(hp.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {hp.v === null ? '—' : format(hp.v)}
        </div>
      )}
    </div>
  )
}
