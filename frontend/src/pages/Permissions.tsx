import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DatabasePicker } from '../components/DatabasePicker'
import { GranteeSelect } from '../components/GranteeSelect'
import { NoInstance, QueryState } from '../components/QueryState'
import { Badge, Button, Checkbox, EmptyRow, Field, Input, Modal, PageHeader, Select, Table } from '../components/ui'
import { grantsQuery, schemasQuery, serverQuery, type ObjectGrants } from '../lib/catalog'
import { privilegesFor, useBasket, type Change, type DefaultKind, type ObjectKind } from '../lib/changes'
import { useDatabase, useInstance } from '../lib/instance'

const TITLES: Record<ObjectKind, string> = {
  database: 'Database privileges',
  schema: 'Schema privileges',
  table: 'Table & view privileges',
  sequence: 'Sequence privileges',
  function: 'Function privileges',
}
const DEFAULT_KIND: Partial<Record<ObjectKind, DefaultKind>> = {
  table: 'tables',
  sequence: 'sequences',
  function: 'functions',
  schema: 'schemas',
}

function objectLabel(o: ObjectGrants) {
  const base = o.schema ? `${o.schema}.${o.name}` : o.name
  return o.args !== null ? `${base}(${o.args})` : base
}

function refFor(kind: ObjectKind, o: ObjectGrants) {
  return kind === 'database' || kind === 'schema' ? { kind, name: o.name } : { kind, schema: o.schema ?? undefined, name: o.name, args: o.args ?? undefined }
}

export function PermissionsPage() {
  const { kind } = useParams({ from: '/app/permissions/$kind' }) as { kind: ObjectKind }
  const { current } = useInstance()
  const { db, profileId } = useDatabase()
  const hasSchema = kind === 'table' || kind === 'sequence' || kind === 'function'
  const [schema, setSchema] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<{ object?: ObjectGrants; bulk?: boolean } | null>(null)
  const [defaults, setDefaults] = useState(false)

  const server = useQuery({ ...serverQuery(profileId), enabled: !!current })
  const schemas = useQuery({ ...schemasQuery(profileId, db), enabled: !!current && !!db && hasSchema })
  const grants = useQuery({
    ...grantsQuery(profileId, db, kind, hasSchema && schema ? schema : undefined),
    enabled: !!current && !!db,
  })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (grants.data ?? []).filter((o) => !q || objectLabel(o).toLowerCase().includes(q))
  }, [grants.data, search])

  const version = server.data?.server_version_num
  const changeDb = kind === 'database' ? null : db

  return (
    <>
      <PageHeader
        title={TITLES[kind]}
        actions={
          <div className="flex items-center gap-3">
            {kind !== 'database' && <DatabasePicker />}
            {hasSchema && (
              <Select className="w-44" value={schema} onChange={(e) => setSchema(e.target.value)}>
                <option value="">All schemas</option>
                {(schemas.data ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            )}
            <Input className="w-52" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        }
      />
      {!current ? (
        <NoInstance />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {hasSchema && (
              <Button variant="secondary" disabled={!schema} onClick={() => setEditing({ bulk: true })} title={schema ? '' : 'Select a schema first'}>
                <Plus className="h-4 w-4" /> Grant / revoke on all {kind}s in schema
              </Button>
            )}
            {DEFAULT_KIND[kind] && (
              <Button variant="secondary" onClick={() => setDefaults(true)}>
                <Plus className="h-4 w-4" /> Default privileges for future {DEFAULT_KIND[kind]}
              </Button>
            )}
          </div>
          {grants.isSuccess ? (
            <Table
              head={
                <tr>
                  <th className="px-3 py-2">{kind === 'function' ? 'Routine' : kind[0].toUpperCase() + kind.slice(1)}</th>
                  {kind === 'table' || kind === 'function' ? <th className="px-3 py-2">Kind</th> : null}
                  <th className="px-3 py-2">Owner</th>
                  <th className="px-3 py-2">Grants</th>
                  <th className="px-3 py-2"></th>
                </tr>
              }
            >
              {rows.map((o) => (
                <tr key={objectLabel(o)} className="hover:bg-ink-50">
                  <td className="px-3 py-2 font-mono">
                    {o.schema && <span className="text-ink-400">{o.schema}.</span>}
                    {o.name}
                    {o.args !== null && <span className="text-ink-500">({o.args})</span>}
                  </td>
                  {kind === 'table' || kind === 'function' ? <td className="px-3 py-2 text-xs text-ink-500">{o.kind}</td> : null}
                  <td className="px-3 py-2 font-mono text-xs">{o.owner}</td>
                  <td className="px-3 py-2">
                    <GrantChips o={o} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-accent-700" onClick={() => setEditing({ object: o })}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <EmptyRow colSpan={5}>No objects.</EmptyRow>}
            </Table>
          ) : (
            <QueryState query={grants} />
          )}
        </>
      )}
      {editing && (
        <GrantEditor
          kind={kind}
          object={editing.object}
          bulkSchema={editing.bulk ? schema : undefined}
          version={version}
          database={changeDb}
          onClose={() => setEditing(null)}
        />
      )}
      {defaults && DEFAULT_KIND[kind] && (
        <DefaultPrivilegesEditor
          objectType={DEFAULT_KIND[kind]}
          schema={hasSchema ? schema : ''}
          version={version}
          database={db}
          onClose={() => setDefaults(false)}
        />
      )}
    </>
  )
}

function GrantChips({ o }: { o: ObjectGrants }) {
  const byGrantee = new Map<string, string[]>()
  for (const g of o.grants) byGrantee.set(g.grantee, [...(byGrantee.get(g.grantee) ?? []), g.privilege + (g.grantable ? '*' : '')])
  if (!byGrantee.size) return <span className="text-xs text-ink-400">none</span>
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {[...byGrantee.entries()].map(([grantee, privs]) => (
        <span key={grantee} className="text-xs">
          <span className={grantee === 'PUBLIC' ? 'font-mono font-semibold text-amber-700' : 'font-mono text-ink-800'}>{grantee}</span>
          <span className="text-ink-500">: {privs.join(', ')}</span>
        </span>
      ))}
      {o.acl_is_default && <Badge>default ACL</Badge>}
    </div>
  )
}

function GrantEditor({
  kind,
  object,
  bulkSchema,
  version,
  database,
  onClose,
}: {
  kind: ObjectKind
  object?: ObjectGrants
  bulkSchema?: string
  version?: number
  database: string | null
  onClose: () => void
}) {
  const basket = useBasket()
  const privileges = privilegesFor(kind, version)
  const [grantee, setGrantee] = useState('')
  const [mode, setMode] = useState<'grant' | 'revoke'>('grant')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [grantOption, setGrantOption] = useState(false)
  const [cascade, setCascade] = useState(false)

  const existing = useMemo(() => {
    const set = new Set<string>()
    if (object && grantee) for (const g of object.grants) if (g.grantee === grantee) set.add(g.privilege)
    return set
  }, [object, grantee])

  const pickGrantee = (g: string) => {
    setGrantee(g)
    if (object) setSelected(new Set(object.grants.filter((x) => x.grantee === g).map((x) => x.privilege)))
  }

  const toggle = (p: string, v: boolean) => {
    const next = new Set(selected)
    if (v) next.add(p)
    else next.delete(p)
    setSelected(next)
  }

  const submit = () => {
    if (!grantee) return
    const ref = object ? refFor(kind, object) : { kind, schema: bulkSchema, all_in_schema: true }
    const ops: Change[] = []
    if (object) {
      const added = privileges.filter((p) => selected.has(p) && !existing.has(p))
      const removed = privileges.filter((p) => !selected.has(p) && existing.has(p))
      if (added.length) ops.push({ op: 'grant', ...ref, grantee, privileges: added, grant_option: grantOption })
      if (removed.length) ops.push({ op: 'revoke', ...ref, grantee, privileges: removed, cascade })
    } else {
      const privs = [...selected]
      if (!privs.length) return
      ops.push(
        mode === 'grant'
          ? { op: 'grant', ...ref, grantee, privileges: privs, grant_option: grantOption }
          : { op: 'revoke', ...ref, grantee, privileges: privs, cascade },
      )
    }
    for (const op of ops) basket.add(op, database)
    onClose()
  }

  const title = object ? `Edit grants · ${objectLabel(object)}` : `All ${kind}s in schema ${bulkSchema}`
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        {!object && (
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === 'grant'} onChange={() => setMode('grant')} /> Grant
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === 'revoke'} onChange={() => setMode('revoke')} /> Revoke
            </label>
          </div>
        )}
        <Field label="Role">
          <GranteeSelect value={grantee} onChange={pickGrantee} />
        </Field>
        {object && grantee && (
          <p className="text-xs text-ink-500">Currently: {existing.size ? [...existing].join(', ') : 'no privileges'}. Tick to grant, untick to revoke.</p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {privileges.map((p) => (
            <Checkbox key={p} label={<span className="font-mono">{p}</span>} checked={selected.has(p)} onChange={(v) => toggle(p, v)} />
          ))}
        </div>
        <div className="flex flex-wrap gap-4">
          {(object || mode === 'grant') && <Checkbox label="WITH GRANT OPTION (for new grants)" checked={grantOption} onChange={setGrantOption} />}
          {(object || mode === 'revoke') && <Checkbox label="CASCADE (for revokes)" checked={cascade} onChange={setCascade} />}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!grantee}>
            Add to pending changes
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function DefaultPrivilegesEditor({
  objectType,
  schema,
  version,
  database,
  onClose,
}: {
  objectType: DefaultKind
  schema: string
  version?: number
  database: string
  onClose: () => void
}) {
  const basket = useBasket()
  const privileges = privilegesFor(objectType, version)
  const [action, setAction] = useState<'grant' | 'revoke'>('grant')
  const [forRole, setForRole] = useState('')
  const [inSchema, setInSchema] = useState(schema)
  const [grantee, setGrantee] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [grantOption, setGrantOption] = useState(false)
  const { db, profileId } = useDatabase()
  const schemas = useQuery(schemasQuery(profileId, db))

  const submit = () => {
    if (!grantee || !selected.size) return
    basket.add(
      {
        op: 'alter_default',
        action,
        for_role: forRole || undefined,
        schema: objectType === 'schemas' ? undefined : inSchema || undefined,
        object_type: objectType,
        grantee,
        privileges: [...selected],
        grant_option: grantOption,
      },
      database,
    )
    onClose()
  }

  return (
    <Modal title={`Default privileges for future ${objectType}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-ink-500">
          Applies to objects created later by the chosen role (or by you, if none is chosen). Existing objects are not affected.
        </p>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={action === 'grant'} onChange={() => setAction('grant')} /> Grant
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={action === 'revoke'} onChange={() => setAction('revoke')} /> Revoke
          </label>
        </div>
        <Field label="Objects created by (FOR ROLE)">
          <GranteeSelect value={forRole} onChange={setForRole} allowPublic={false} placeholder="Current user" />
        </Field>
        {objectType !== 'schemas' && (
          <Field label="In schema">
            <Select value={inSchema} onChange={(e) => setInSchema(e.target.value)}>
              <option value="">Any schema</option>
              {(schemas.data ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={action === 'grant' ? 'Grant to' : 'Revoke from'}>
          <GranteeSelect value={grantee} onChange={setGrantee} />
        </Field>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {privileges.map((p) => (
            <Checkbox
              key={p}
              label={<span className="font-mono">{p}</span>}
              checked={selected.has(p)}
              onChange={(v) => {
                const next = new Set(selected)
                if (v) next.add(p)
                else next.delete(p)
                setSelected(next)
              }}
            />
          ))}
        </div>
        {action === 'grant' && <Checkbox label="WITH GRANT OPTION" checked={grantOption} onChange={setGrantOption} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!grantee || !selected.size}>
            Add to pending changes
          </Button>
        </div>
      </div>
    </Modal>
  )
}
