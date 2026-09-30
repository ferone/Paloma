import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'

const SettingsPage = lazy(() => import('./SettingsPage'))

export const routes: RouteObject[] = [{ path: 'settings', element: page(<SettingsPage />) }]
