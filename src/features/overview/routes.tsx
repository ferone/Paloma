import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'
import { Placeholder } from '../../app/Placeholder'

// Routes for the overview section. Owned by the overview workstream.
export const routes: RouteObject[] = [
  {
    index: true,
    element: page(
      <Placeholder
        eyebrow="Fund"
        title="Overview"
        description="NAV, allocation, today's P&L, top opportunities and the macro regime at a glance."
      />,
    ),
  },
]
