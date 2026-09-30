import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'
import { DataLayout } from './DataLayout'

// Routes for the Data Center. Owned by the marketdata workstream.
const DatasetsPage = lazy(() => import('./pages/DatasetsPage'))
const DownloadPage = lazy(() => import('./pages/DownloadPage'))
const DatabentoPage = lazy(() => import('./pages/DatabentoPage'))
const JobsPage = lazy(() => import('./pages/JobsPage'))

export const routes: RouteObject[] = [
  {
    path: 'data',
    element: <DataLayout />,
    children: [
      { index: true, element: page(<DatasetsPage />) },
      { path: 'download', element: page(<DownloadPage />) },
      { path: 'databento', element: page(<DatabentoPage />) },
      { path: 'jobs', element: page(<JobsPage />) },
    ],
  },
]
