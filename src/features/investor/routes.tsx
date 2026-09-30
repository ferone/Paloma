import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'
import { Placeholder } from '../../app/Placeholder'

// Routes for the investor section. Owned by the investor workstream.
export const routes: RouteObject[] = [
  {
    path: 'investor/*',
    element: page(
      <Placeholder
        eyebrow="Fund"
        title="Investor report"
        description="Read-only factsheet for investors: NAV, performance, allocation, risk and commentary."
      />,
    ),
  },
]
