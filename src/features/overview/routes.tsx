import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'

const OverviewPage = lazy(() => import('./OverviewPage'))

export const routes: RouteObject[] = [{ index: true, element: page(<OverviewPage />) }]
