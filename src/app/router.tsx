import { createBrowserRouter, Link, type RouteObject } from 'react-router-dom'
import { AppShell } from './AppShell'
import { EmptyState } from '../ui'
import { routes as overviewRoutes } from '../features/overview/routes'
import { routes as portfolioRoutes } from '../features/portfolio/routes'
import { routes as marketsRoutes } from '../features/markets/routes'
import { routes as quantRoutes } from '../features/quant/routes'
import { routes as macroRoutes } from '../features/macro/routes'
import { routes as intelligenceRoutes } from '../features/intelligence/routes'
import { routes as dataRoutes } from '../features/data/routes'
import { routes as investorRoutes } from '../features/investor/routes'
import { routes as settingsRoutes } from '../features/settings/routes'

// Each feature owns its `routes.tsx` (paths relative to the root). Adding a
// section = one import + one spread here, plus an entry in nav.ts.
const children: RouteObject[] = [
  ...overviewRoutes,
  ...portfolioRoutes,
  ...marketsRoutes,
  ...quantRoutes,
  ...macroRoutes,
  ...intelligenceRoutes,
  ...dataRoutes,
  ...investorRoutes,
  ...settingsRoutes,
  {
    path: '*',
    element: (
      <EmptyState title="Page not found" action={<Link className="text-sm text-brand underline" to="/">Back to overview</Link>}>
        The address doesn’t match any section.
      </EmptyState>
    ),
  },
]

export const router = createBrowserRouter([{ element: <AppShell />, children }])
