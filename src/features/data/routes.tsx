import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'
import { Placeholder } from '../../app/Placeholder'

// Routes for the data section. Owned by the data workstream.
export const routes: RouteObject[] = [
  {
    path: 'data/*',
    element: page(
      <Placeholder
        eyebrow="System"
        title="Data Center"
        description="Download market data and analysis, run refreshes and monitor data freshness."
      />,
    ),
  },
]
