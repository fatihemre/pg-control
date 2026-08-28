import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Pencil, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { GranteeSelect } from '../components/GranteeSelect'
import { NoInstance, QueryState } from '../components/QueryState'
import { Button, EmptyRow, Field, Input, Modal, PageHeader, Select, Table } from '../components/ui'
import { databasesQuery, roleDbSettingsQuery, settingsQuery, type RoleDbSetting } from '../lib/catalog'
import { useBasket } from '../lib/changes'
import { useInstance } from '../lib/instance'

export function OverridesPage() {
  const { current } = useInstance()
  const profileId = current?.id ?? 0
  const basket = useBasket()
  const overrides = useQuery({ ...roleDbSettingsQuery(profileId), enabled: !!current })
  const [editing, setEditing] = useState<{ row?: RoleDbSetting } | null>(null)

  const reset = (o: RoleDbSetting) => {
    if (o.role) basket.add({ op: 'alter_role_config', role: o.role, name: o.name, database: o.database ?? undefined }, null)
    else if (o.database) basket.add({ op: 'alter_database_config', database: o.database, name: o.name }, null)
  }

  return (
    <>
      <PageHeader
        title="Role & database overrides"
        actions={
          <Button className="whitespace-nowrap" onClick={() => setEditing({})}>
            <Plus className="h-4 w-4" /> Add override
          </Button>
        }
      />
      <p className="mb-4 text-sm text-ink-600">
        Parameters set with <span className="font-mono">ALTER ROLE … SET</span> and <span className="font-mono">ALTER DATABASE … SET</span>. They take
        precedence over the server settings for new sessions of that role / in that database.
      </p>
      {!current ? (
        <NoInstance />
      ) : overrides.isSuccess ? (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Database</th>
              <th className="px-3 py-2">Parameter</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2"></th>
            </tr>
          }
        >
          {overrides.data.map((o) => (
            <tr key={`${o.role}/${o.database}/${o.name}`} className="hover:bg-ink-50">
              <td className="px-3 py-2 font-mono">
                {o.role ? (
                  <Link to="/roles/$name" params={{ name: o.role }} className="text-accent-700 hover:underline">
                    {o.role}
                  </Link>
                ) : (
                  <span className="text-ink-400">all roles</span>
                )}
              </td>
              <td className="px-3 py-2 font-mono">{o.database ?? <span className="text-ink-400">all databases</span>}</td>
              <td className="px-3 py-2 font-mono text-xs">{o.name}</td>
              <td className="px-3 py-2 font-mono text-xs">{o.value}</td>
              <td className="px-3 py-2 text-right">
                <span className="inline-flex gap-3">
                  <button className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-accent-700" onClick={() => setEditing({ row: o })}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-red-700" onClick={() => reset(o)}>
                    <X className="h-3.5 w-3.5" /> Reset
                  </button>
                </span>
              </td>
            </tr>
          ))}
          {overrides.data.length === 0 && <EmptyRow colSpan={5}>No overrides.</EmptyRow>}
        </Table>
      ) : (
        <QueryState query={overrides} />
      )}
      {editing && <OverrideEditor row={editing.row} onClose={() => setEditing(null)} />}
    </>
  )
}

function OverrideEditor({ row, onClose }: { row?: RoleDbSetting; onClose: () => void }) {
  const { current } = useInstance()
  const profileId = current?.id ?? 0
  const basket = useBasket()
  const databases = useQuery(databasesQuery(profileId))
  const settings = useQuery(settingsQuery(profileId))
  const [scope, setScope] = useState<'role' | 'database'>(row && !row.role ? 'database' : 'role')
  const [role, setRole] = useState(row?.role ?? '')
  const [database, setDatabase] = useState(row?.database ?? '')
  const [name, setName] = useState(row?.name ?? '')
  const [value, setValue] = useState(row?.value ?? '')

  const valid = name.trim() && value !== '' && (scope === 'role' ? !!role : !!database)
  const submit = () => {
    if (!valid) return
    if (scope === 'role') basket.add({ op: 'alter_role_config', role, name: name.trim(), value, database: database || undefined }, null)
    else basket.add({ op: 'alter_database_config', database, name: name.trim(), value }, null)
    onClose()
  }

  return (
    <Modal title={row ? 'Edit override' : 'Add override'} onClose={onClose}>
      <div className="space-y-4">
        {!row && (
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={scope === 'role'} onChange={() => setScope('role')} /> For a role
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={scope === 'database'} onChange={() => setScope('database')} /> For a database
            </label>
          </div>
        )}
        {scope === 'role' && (
          <Field label="Role">
            {row ? <Input value={role} disabled /> : <GranteeSelect value={role} onChange={setRole} allowPublic={false} includeSystem />}
          </Field>
        )}
        <Field label={scope === 'role' ? 'Only in database (optional)' : 'Database'}>
          <Select value={database} disabled={!!row} onChange={(e) => setDatabase(e.target.value)}>
            <option value="">{scope === 'role' ? 'All databases' : 'Select…'}</option>
            {(databases.data ?? []).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Parameter">
          <Input list="pg-params" value={name} disabled={!!row} onChange={(e) => setName(e.target.value)} className="font-mono" />
          <datalist id="pg-params">
            {(settings.data ?? [])
              .filter((s) => s.context === 'user' || s.context === 'superuser')
              .map((s) => (
                <option key={s.name} value={s.name} />
              ))}
          </datalist>
        </Field>
        <Field label="Value">
          <Input value={value} onChange={(e) => setValue(e.target.value)} className="font-mono" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid}>
            Add to pending changes
          </Button>
        </div>
      </div>
    </Modal>
  )
}
