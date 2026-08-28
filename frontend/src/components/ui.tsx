import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const variants: Record<Variant, string> = {
  primary: 'bg-accent-600 text-white hover:bg-accent-500 disabled:bg-ink-300',
  secondary: 'bg-white text-ink-900 border border-ink-300 hover:bg-ink-100 disabled:text-ink-300',
  danger: 'bg-white text-red-700 border border-red-300 hover:bg-red-50 disabled:text-ink-300',
  ghost: 'text-ink-700 hover:bg-ink-100',
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        variants[variant],
        className,
      )}
      {...props}
    />
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm text-ink-900 placeholder:text-ink-300 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100',
        className,
      )}
      {...props}
    />
  )
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        'w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100',
        className,
      )}
      {...props}
    />
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  )
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'ok' | 'warn' | 'bad'
  children: ReactNode
}) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-700',
    ok: 'bg-emerald-100 text-emerald-800',
    warn: 'bg-amber-100 text-amber-800',
    bad: 'bg-red-100 text-red-800',
  }
  return (
    <span className={cx('inline-flex rounded px-1.5 py-0.5 font-mono text-xs', tones[tone])}>
      {children}
    </span>
  )
}

export function Alert({ tone, children }: { tone: 'error' | 'ok'; children: ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-md border px-3 py-2 text-sm',
        tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900',
      )}
    >
      {children}
    </div>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-950/40 p-4 sm:py-12" onClick={onClose}>
      <div
        className="mx-auto w-full max-w-xl rounded-lg bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="text-ink-500 hover:text-ink-900" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {actions}
    </div>
  )
}
