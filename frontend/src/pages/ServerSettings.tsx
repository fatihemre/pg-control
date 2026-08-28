import { useQuery } from '@tanstack/react-query'
import { Pencil, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { NoInstance, QueryState } from '../components/QueryState'
import { Alert, Badge, Button, Checkbox, EmptyRow, Field, Input, Modal, PageHeader, Select, Table } from '../components/ui'
import { fileSettingsQuery, settingsQuery, type Setting } from '../lib/catalog'
import { useBasket } from '../lib/changes'
import { useInstance } from '../lib/instance'

const EDITABLE = new Set(['postmaster', 'sighup', 'superuser-backend', 'backend', 'superuser', 'user'])

function display(s: Setting) {
  if (s.setting === null) return ''
  return s.unit && s.vartype !== 'string' ? `${s.setting} ${s.unit}` : s.setting
}

export function ServerSettingsPage() {
  const { current } = useInstance()
  const profileId = current?.id ?? 0
  const basket = useBasket()
  const settings = useQuery({ ...settingsQuery(profileId), enabled: !!current })
  const files = useQuery({ ...fileSettingsQuery(profileId), enabled: !!current })
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [nonDefault, setNonDefault] = useState(false)
  const [editing, setEditing] = useState<Setting | null>(null)

  const categories = useMemo(() => [...new Set((settings.data ?? []).map((s) => s.category))].sort(), [settings.data])
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (settings.data ?? []).filter(
      (s) =>
        (!category || s.category === category) &&
        (!nonDefault || !s.is_default) &&
        (!q || s.name.includes(q) || s.short_desc.toLowerCase().includes(q)),
    )
  }, [settings.data, search, category, nonDefault])

  const pendingRestart = (settings.data ?? []).filter((s) => s.pending_restart)
  const fileErrors = (files.data?.rows ?? []).filter((f) => f.error)

  return (
    <>
      <PageHeader
        title="Server settings"
        actions={
          <div className="flex items-center gap-3">
            <Select className="w-64" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Input className="w-52" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <span className="whitespace-nowrap">
              <Checkbox label="Non-default only" checked={nonDefault} onChange={setNonDefault} />
            </span>
            <Button variant="secondary" className="whitespace-nowrap" onClick={() => basket.add({ op: 'reload_conf' }, null)}>
              <RefreshCw className="h-4 w-4" /> Reload config
            </Button>
          </div>
        }
      />
      {!current ? (
        <NoInstance />
      ) : (
        <>
          {pendingRestart.length > 0 && (
            <div className="mb-3">
              <Alert tone="error">
                Restart required to apply: {pendingRestart.map((s) => s.name).join(', ')}
              </Alert>
            </div>
          )}
          {fileErrors.length > 0 && (
            <div className="mb-3">
              <Alert tone="error">
                Configuration file errors (settings not applied):
                <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                  {fileErrors.map((f) => (
                    <li key={f.seqno}>
                      {f.sourcefile}:{f.sourceline} {f.name} = {f.setting} — {f.error}
                    </li>
                  ))}
                </ul>
              </Alert>
            </div>
          )}
          {settings.isSuccess ? (
            <Table
              head={
                <tr>
                  <th className="px-3 py-2">Parameter</th>
                  <th className="px-3 py-2">Value</th>
                  <th className="px-3 py-2">Context</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2"></th>
                </tr>
              }
            >
              {rows.map((s) => (
                <tr key={s.name} className="hover:bg-ink-50">
                  <td className="px-3 py-2 font-mono text-xs">
                    {s.name}
                    {s.pending_restart && (
                      <span className="ml-1">
                        <Badge tone="bad">restart</Badge>
                      </span>
                    )}
                  </td>
                  <td className={s.is_default ? 'px-3 py-2 font-mono text-xs text-ink-600' : 'px-3 py-2 font-mono text-xs font-semibold text-ink-900'}>
                    {display(s)}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-500">{s.context}</td>
                  <td className="px-3 py-2 text-xs text-ink-500" title={s.sourcefile ? `${s.sourcefile}:${s.sourceline}` : undefined}>
                    {s.source}
                  </td>
                  <td className="max-w-md px-3 py-2 text-xs text-ink-600">{s.short_desc}</td>
                  <td className="px-3 py-2 text-right">
                    {EDITABLE.has(s.context) && (
                      <button className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-accent-700" onClick={() => setEditing(s)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <EmptyRow colSpan={6}>No parameters match.</EmptyRow>}
            </Table>
          ) : (
            <QueryState query={settings} />
          )}
        </>
      )}
      {editing && <SettingEditor setting={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function SettingEditor({ setting, onClose }: { setting: Setting; onClose: () => void }) {
  const basket = useBasket()
  const initial = setting.vartype === 'bool' ? (setting.setting === 'on' ? 'on' : 'off') : (setting.setting ?? '')
  const [value, setValue] = useState(initial)
  const [reset, setReset] = useState(false)
  const restart = setting.context === 'postmaster'

  const submit = () => {
    basket.add({ op: 'alter_system', name: setting.name, value: reset ? undefined : value }, null)
    onClose()
  }

  return (
    <Modal title={`ALTER SYSTEM · ${setting.name}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-700">{setting.short_desc}</p>
        {setting.extra_desc && <p className="text-xs text-ink-500">{setting.extra_desc}</p>}
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <dt className="text-ink-500">Current</dt>
          <dd className="col-span-2 font-mono">{display(setting) || '—'}</dd>
          <dt className="text-ink-500">Default</dt>
          <dd className="col-span-2 font-mono">{setting.boot_val ?? '—'}</dd>
          {setting.min_val && (
            <>
              <dt className="text-ink-500">Range</dt>
              <dd className="col-span-2 font-mono">
                {setting.min_val} … {setting.max_val}
              </dd>
            </>
          )}
          <dt className="text-ink-500">Context</dt>
          <dd className="col-span-2 font-mono">{setting.context}</dd>
        </dl>
        <Field label="New value" hint={setting.unit ? `Units accepted (e.g. 64MB, 5min); base unit is ${setting.unit}` : undefined}>
          {setting.vartype === 'bool' ? (
            <Select value={value} disabled={reset} onChange={(e) => setValue(e.target.value)}>
              <option value="on">on</option>
              <option value="off">off</option>
            </Select>
          ) : setting.vartype === 'enum' && setting.enumvals ? (
            <Select value={value} disabled={reset} onChange={(e) => setValue(e.target.value)}>
              {setting.enumvals.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          ) : (
            <Input value={value} disabled={reset} onChange={(e) => setValue(e.target.value)} className="font-mono" />
          )}
        </Field>
        <Checkbox label="Reset to default (ALTER SYSTEM RESET — removes it from postgresql.auto.conf)" checked={reset} onChange={setReset} />
        <Alert tone={restart ? 'error' : 'ok'}>
          {restart
            ? 'This parameter needs a server restart to take effect.'
            : 'Takes effect after a configuration reload; add "Reload config" to the pending changes.'}
        </Alert>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!reset && value === ''}>
            Add to pending changes
          </Button>
        </div>
      </div>
    </Modal>
  )
}
