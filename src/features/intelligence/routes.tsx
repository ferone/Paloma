import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'
import { IntelligenceLayout } from './IntelligenceLayout'

// Routes for the intelligence (ML) section.
const SignalPage = lazy(() => import('./pages/SignalPage'))
const ValidationPage = lazy(() => import('./pages/ValidationPage'))
const FeaturesPage = lazy(() => import('./pages/FeaturesPage'))
const CalibrationPage = lazy(() => import('./pages/CalibrationPage'))
const RunsPage = lazy(() => import('./pages/RunsPage'))

export const routes: RouteObject[] = [
  {
    path: 'intelligence',
    element: <IntelligenceLayout />,
    children: [
      { index: true, element: page(<SignalPage />) },
      { path: 'validation', element: page(<ValidationPage />) },
      { path: 'features', element: page(<FeaturesPage />) },
      { path: 'calibration', element: page(<CalibrationPage />) },
      { path: 'runs', element: page(<RunsPage />) },
    ],
  },
]
