import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'
import { MarketsLayout } from './MarketsLayout'

// Routes for the markets section. Owned by the markets workstream.
const PricesPage = lazy(() => import('./pages/PricesPage'))
const CurvePage = lazy(() => import('./pages/CurvePage'))
const EtfsPage = lazy(() => import('./pages/EtfsPage'))
const TechnicalsPage = lazy(() => import('./pages/TechnicalsPage'))
const ComparisonPage = lazy(() => import('./pages/ComparisonPage'))
const LiquidityPage = lazy(() => import('./pages/LiquidityPage'))

export const routes: RouteObject[] = [
  {
    path: 'markets',
    element: <MarketsLayout />,
    children: [
      { index: true, element: page(<PricesPage />) },
      { path: 'curve', element: page(<CurvePage />) },
      { path: 'etfs', element: page(<EtfsPage />) },
      { path: 'signals', element: page(<TechnicalsPage />) },
      { path: 'signals/:symbol', element: page(<TechnicalsPage />) },
      { path: 'comparison', element: page(<ComparisonPage />) },
      { path: 'liquidity', element: page(<LiquidityPage />) },
    ],
  },
]
