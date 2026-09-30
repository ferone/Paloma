import type { RouteObject } from 'react-router-dom'
import { page } from '../../app/page'
import { Placeholder } from '../../app/Placeholder'

// Routes for the quant section. Owned by the quant workstream.
export const routes: RouteObject[] = [
  {
    path: 'quant/*',
    element: page(
      <Placeholder
        eyebrow="Research"
        title="Quant Lab"
        description="Calendar spreads, butterflies, seasonality and relative value for gold and silver futures, with out-of-sample validation."
      />,
    ),
  },
]
