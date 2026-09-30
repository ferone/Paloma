import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'
import { PortfolioLayout } from './PortfolioLayout'

// Routes for the portfolio section. Owned by the portfolio workstream.
const HoldingsPage = lazy(() => import('./pages/HoldingsPage'))
const LedgerPage = lazy(() => import('./pages/LedgerPage'))
const PerformancePage = lazy(() => import('./pages/PerformancePage'))
const VaultPage = lazy(() => import('./pages/VaultPage'))
const ScenarioPage = lazy(() => import('./scenario/ScenarioPage'))

export const routes: RouteObject[] = [
  {
    path: 'portfolio',
    element: <PortfolioLayout />,
    children: [
      { index: true, element: page(<HoldingsPage />) },
      { path: 'ledger', element: page(<LedgerPage />) },
      { path: 'performance', element: page(<PerformancePage />) },
      { path: 'vault', element: page(<VaultPage />) },
      { path: 'scenario', element: page(<ScenarioPage />) },
    ],
  },
]
