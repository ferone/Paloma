import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'
import { Placeholder } from '../../app/Placeholder'

// Routes for the portfolio section. Owned by the portfolio workstream.
export const routes: RouteObject[] = [
  {
    path: 'portfolio/*',
    element: page(
      <Placeholder
        eyebrow="Fund"
        title="Portfolio"
        description="Holdings, ledger of every entry and exit, performance and risk across ETFs, futures and physical metal."
      />,
    ),
  },
]
