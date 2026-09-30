import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'
import { MacroLayout } from './MacroLayout'

// Routes for the macro section. Owned by the macro workstream.
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const PositioningPage = lazy(() => import('./pages/PositioningPage'))
const CorrelationsPage = lazy(() => import('./pages/CorrelationsPage'))
const AnalystPage = lazy(() => import('./pages/AnalystPage'))

export const routes: RouteObject[] = [
  {
    path: 'macro',
    element: <MacroLayout />,
    children: [
      { index: true, element: page(<DashboardPage />) },
      { path: 'positioning', element: page(<PositioningPage />) },
      { path: 'correlations', element: page(<CorrelationsPage />) },
      { path: 'analyst', element: page(<AnalystPage />) },
    ],
  },
]
