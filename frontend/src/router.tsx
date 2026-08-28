import { QueryClient } from '@tanstack/react-query'
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'
import { Layout } from './components/Layout'
import { meQuery } from './lib/auth'
import { ConnectionsPage } from './pages/Connections'
import { EffectivePrivilegesPage, type EffectiveSearch } from './pages/EffectivePrivileges'
import { RoleDetailPage } from './pages/RoleDetail'
import { RolesPage } from './pages/Roles'
import { AuditPage } from './pages/Audit'
import { ClientAuthPage } from './pages/ClientAuth'
import { ExtensionsPage } from './pages/Extensions'
import { OverridesPage } from './pages/Overrides'
import { ServerSettingsPage } from './pages/ServerSettings'
import { MembershipsPage } from './pages/Memberships'
import { PermissionsPage } from './pages/Permissions'
import { RoleAttributesPage } from './pages/RoleAttributes'
import { LoginPage } from './pages/Login'
import { PlaceholderPage } from './pages/Placeholder'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
})

const appRoute = createRoute({
  id: 'app',
  getParentRoute: () => rootRoute,
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery)
    } catch {
      throw redirect({ to: '/login' })
    }
  },
  component: Layout,
})

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/connections' })
  },
})

const connectionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/connections',
  component: ConnectionsPage,
})

const rolesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/roles',
  component: RolesPage,
})

const roleDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/roles/$name',
  component: RoleDetailPage,
})

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

const effectiveRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/security/effective',
  validateSearch: (s: Record<string, unknown>): EffectiveSearch => ({
    db: str(s.db),
    role: str(s.role),
    schema: str(s.schema),
  }),
  component: EffectivePrivilegesPage,
})

const membershipsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/roles/memberships',
  component: MembershipsPage,
})

const attributesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/roles/attributes',
  component: RoleAttributesPage,
})

const permissionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/permissions/$kind',
  beforeLoad: ({ params }) => {
    if (!['database', 'schema', 'table', 'sequence', 'function'].includes(params.kind)) {
      throw redirect({ to: '/permissions/$kind', params: { kind: 'table' } })
    }
  },
  component: PermissionsPage,
})

const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/security/audit',
  component: AuditPage,
})

const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/config/settings', component: ServerSettingsPage })
const overridesRoute = createRoute({ getParentRoute: () => appRoute, path: '/config/overrides', component: OverridesPage })
const hbaRoute = createRoute({ getParentRoute: () => appRoute, path: '/config/hba', component: ClientAuthPage })
const extensionsRoute = createRoute({ getParentRoute: () => appRoute, path: '/config/extensions', component: ExtensionsPage })

const placeholderRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '$',
  component: PlaceholderPage,
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    indexRoute,
    connectionsRoute,
    rolesRoute,
    roleDetailRoute,
    effectiveRoute,
    membershipsRoute,
    attributesRoute,
    permissionsRoute,
    auditRoute,
    settingsRoute,
    overridesRoute,
    hbaRoute,
    extensionsRoute,
    placeholderRoute,
  ]),
])

export const router = createRouter({ routeTree, context: { queryClient } })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
