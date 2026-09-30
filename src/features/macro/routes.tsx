import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'
import { Placeholder } from '../../app/Placeholder'

// Routes for the macro section. Owned by the macro workstream.
export const routes: RouteObject[] = [
  {
    path: 'macro/*',
    element: page(
      <Placeholder
        eyebrow="Research"
        title="Macro &amp; AI"
        description="Real yields, the dollar, inflation, positioning and AI-written macro briefs with sources."
      />,
    ),
  },
]
