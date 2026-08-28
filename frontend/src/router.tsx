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

const placeholderRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '$',
  component: PlaceholderPage,
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([indexRoute, connectionsRoute, placeholderRoute]),
])

export const router = createRouter({ routeTree, context: { queryClient } })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
