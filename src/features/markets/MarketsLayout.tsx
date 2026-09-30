import { Outlet } from 'react-router-dom'
import { PageHeader, RouteTabs } from '../../ui'

export function MarketsLayout() {
  return (
    <>
      <PageHeader
        eyebrow="Research"
        title="Markets"
        description="Live prices, technicals, term structure, ETF premia and liquidity for gold and silver."
      />
      <RouteTabs
        items={[
          { to: '/markets', label: 'Prices', end: true },
          { to: '/markets/signals', label: 'Technicals' },
          { to: '/markets/comparison', label: 'Comparison' },
          { to: '/markets/liquidity', label: 'Liquidity' },
        ]}
      />
      <Outlet />
    </>
  )
}
