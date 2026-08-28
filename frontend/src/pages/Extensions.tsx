import { useQuery } from '@tanstack/react-query'
import { ArrowUpCircle, Download, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DatabasePicker } from '../components/DatabasePicker'
import { NoInstance, QueryState } from '../components/QueryState'
import { Alert, Badge, Button, Checkbox, EmptyRow, Field, Input, Modal, PageHeader, Select, Table } from '../components/ui'
import { extensionsQuery, schemasQuery, type Extension } from '../lib/catalog'
import { useBasket } from '../lib/changes'
import { useDatabase, useInstance } from '../lib/instance'

export function ExtensionsPage() {
  const { current } = useInstance()
  const { db, profileId } = useDatabase()
  const basket = useBasket()
  const exts = useQuery({ ...extensionsQuery(profileId, db), enabled: !!current && !!db })
  const [search, setSearch] = useState('')
  const [installedOnly, setInstalledOnly] = useState(false)
  const [installing, setInstalling] = useState<Extension | null>(null)
  const [dropping, setDropping] = useState<Extension | null>(null)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (exts.data ?? []).filter((e) => (!installedOnly || e.installed_version) && (!q || e.name.includes(q) || (e.comment ?? '').toLowerCase().includes(q)))
  }, [exts.data, search, installedOnly])

  return (
    <>
      <PageHeader
        title="Extensions"
        actions={
          <div className="flex items-center gap-3">
            <DatabasePicker />
            <Input className="w-52" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <span className="whitespace-nowrap">
              <Checkbox label="Installed only" checked={installedOnly} onChange={setInstalledOnly} />
            </span>
          </div>
        }
      />
      {!current ? (
        <NoInstance />
      ) : exts.isSuccess ? (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Extension</th>
              <th className="px-3 py-2">Installed</th>
              <th className="px-3 py-2">Available</th>
              <th className="px-3 py-2">Schema</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2"></th>
            </tr>
          }
        >
          {rows.map((e) => (
            <tr key={e.name} className="hover:bg-ink-50">
              <td className="px-3 py-2 font-mono">
                {e.name}
                {e.trusted === false && e.superuser_required && !e.installed_version && (
                  <span className="ml-1">
                    <Badge tone="warn">superuser</Badge>
                  </span>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-xs">
                {e.installed_version ? <Badge tone="ok">{e.installed_version}</Badge> : <span className="text-ink-400">—</span>}
              </td>
              <td className="px-3 py-2 font-mono text-xs">
                {e.default_version}
                {e.update_available && (
                  <span className="ml-1">
                    <Badge tone="warn">update</Badge>
                  </span>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{e.schema ?? ''}</td>
              <td className="max-w-md px-3 py-2 text-xs text-ink-600">{e.comment}</td>
              <td className="px-3 py-2 text-right">
                <span className="inline-flex gap-3 whitespace-nowrap">
                  {!e.installed_version && (
                    <button className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-accent-700" onClick={() => setInstalling(e)}>
                      <Download className="h-3.5 w-3.5" /> Install
                    </button>
                  )}
                  {e.update_available && (
                    <button
                      className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-accent-700"
                      onClick={() => basket.add({ op: 'update_extension', name: e.name, version: e.default_version ?? undefined }, db)}
                    >
                      <ArrowUpCircle className="h-3.5 w-3.5" /> Update
                    </button>
                  )}
                  {e.installed_version && e.name !== 'plpgsql' && (
                    <button className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-red-700" onClick={() => setDropping(e)}>
                      <Trash2 className="h-3.5 w-3.5" /> Drop
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow colSpan={6}>No extensions.</EmptyRow>}
        </Table>
      ) : (
        <QueryState query={exts} />
      )}
      {installing && <InstallExtension ext={installing} database={db} onClose={() => setInstalling(null)} />}
      {dropping && (
        <Modal title={`Drop extension · ${dropping.name}`} onClose={() => setDropping(null)}>
          <div className="space-y-4">
            <Alert tone="error">Dropping removes every object the extension provides. Objects that depend on them block the drop unless CASCADE is used.</Alert>
            <DropExtension ext={dropping} database={db} onClose={() => setDropping(null)} />
          </div>
        </Modal>
      )}
    </>
  )
}

function InstallExtension({ ext, database, onClose }: { ext: Extension; database: string; onClose: () => void }) {
  const basket = useBasket()
  const { profileId } = useDatabase()
  const schemas = useQuery(schemasQuery(profileId, database))
  const [schema, setSchema] = useState('')
  const [version, setVersion] = useState('')
  const [cascade, setCascade] = useState(false)
  return (
    <Modal title={`Install extension · ${ext.name}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-700">{ext.comment}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Schema" hint={ext.relocatable === false ? 'Extension may define a fixed schema' : undefined}>
            <Select value={schema} onChange={(e) => setSchema(e.target.value)}>
              <option value="">Default (current search_path)</option>
              {(schemas.data ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Version">
            <Select value={version} onChange={(e) => setVersion(e.target.value)}>
              <option value="">Default ({ext.default_version})</option>
              {ext.versions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Checkbox label="CASCADE (also install extensions it depends on)" checked={cascade} onChange={setCascade} />
        {ext.superuser_required && ext.trusted === false && <Alert tone="error">This extension can only be installed by a superuser.</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              basket.add({ op: 'create_extension', name: ext.name, schema: schema || undefined, version: version || undefined, cascade }, database)
              onClose()
            }}
          >
            Add to pending changes
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function DropExtension({ ext, database, onClose }: { ext: Extension; database: string; onClose: () => void }) {
  const basket = useBasket()
  const [cascade, setCascade] = useState(false)
  return (
    <>
      <Checkbox label="CASCADE (drop dependent objects too)" checked={cascade} onChange={setCascade} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            basket.add({ op: 'drop_extension', name: ext.name, cascade }, database)
            onClose()
          }}
        >
          Add DROP EXTENSION to pending changes
        </Button>
      </div>
    </>
  )
}
