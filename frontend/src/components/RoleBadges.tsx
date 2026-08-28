import { Badge } from './ui'
import type { RoleSummary } from '../lib/catalog'

export function RoleBadges({ role, compact }: { role: RoleSummary; compact?: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {role.superuser && <Badge tone="warn">SUPERUSER</Badge>}
      {role.canlogin ? <Badge tone="ok">LOGIN</Badge> : !compact && <Badge>NOLOGIN</Badge>}
      {!role.inherit && <Badge tone="warn">NOINHERIT</Badge>}
      {role.createrole && <Badge>CREATEROLE</Badge>}
      {role.createdb && <Badge>CREATEDB</Badge>}
      {role.replication && <Badge>REPLICATION</Badge>}
      {role.bypassrls && <Badge tone="warn">BYPASSRLS</Badge>}
      {role.expired && <Badge tone="bad">EXPIRED</Badge>}
      {role.connlimit === 0 && <Badge tone="bad">CONNLIMIT 0</Badge>}
    </span>
  )
}
