import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'
import { Placeholder } from '../../app/Placeholder'

// Routes for the intelligence section. Owned by the intelligence workstream.
export const routes: RouteObject[] = [
  {
    path: 'intelligence/*',
    element: page(
      <Placeholder
        eyebrow="Research"
        title="Intelligence"
        description="Machine-learning signals with honest walk-forward validation."
      />,
    ),
  },
]
