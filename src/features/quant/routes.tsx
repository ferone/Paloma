import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'
import { QuantLayout } from './QuantLayout'

// Routes for the quant section. Owned by the quant workstream.
const ScannerPage = lazy(() => import('./pages/ScannerPage'))
const SpreadsPage = lazy(() => import('./pages/SpreadsPage'))
const SeasonalityPage = lazy(() => import('./pages/SeasonalityPage'))
const RelativeValuePage = lazy(() => import('./pages/RelativeValuePage'))
const CurvePage = lazy(() => import('./pages/CurvePage'))
const BacktestPage = lazy(() => import('./pages/BacktestPage'))
const InstrumentPage = lazy(() => import('./pages/InstrumentPage'))

export const routes: RouteObject[] = [
  {
    path: 'quant',
    element: <QuantLayout />,
    children: [
      { index: true, element: page(<ScannerPage />) },
      { path: 'spreads', element: page(<SpreadsPage />) },
      { path: 'seasonality', element: page(<SeasonalityPage />) },
      { path: 'relative-value', element: page(<RelativeValuePage />) },
      { path: 'curve', element: page(<CurvePage />) },
      { path: 'backtest', element: page(<BacktestPage />) },
      { path: 'i/:id', element: page(<InstrumentPage />) },
    ],
  },
]
