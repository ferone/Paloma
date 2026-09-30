import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'

const InvestorReportPage = lazy(() => import('./InvestorReportPage'))

export const routes: RouteObject[] = [{ path: 'investor', element: page(<InvestorReportPage />) }]
