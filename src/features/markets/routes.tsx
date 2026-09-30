import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'
import { MarketsLayout } from './MarketsLayout'

// Routes for the markets section. Owned by the markets workstream.
// Legacy pages are mounted here until they are migrated into this folder.
const DashboardPage = lazy(() => import('../../pages/DashboardPage'))
const SignalsPage = lazy(() => import('../../pages/SignalsPage'))
const ComparisonPage = lazy(() => import('../../pages/ComparisonPage'))
const LiquidityPage = lazy(() => import('../../pages/LiquidityPage'))

export const routes: RouteObject[] = [
  {
    path: 'markets',
    element: <MarketsLayout />,
    children: [
      { index: true, element: page(<DashboardPage />) },
      { path: 'signals', element: page(<SignalsPage />) },
      { path: 'signals/:symbol', element: page(<SignalsPage />) },
      { path: 'comparison', element: page(<ComparisonPage />) },
      { path: 'liquidity', element: page(<LiquidityPage />) },
    ],
  },
]
