import { Outlet } from 'react-router-dom'
import { UNIVERSE } from '@shared/universe'
import { useSettings } from '../../store/settings-context'
import { PageHeader, RouteTabs } from '../../ui'

export function MarketsLayout() {
  const { metal } = useSettings()
  const spec = UNIVERSE[metal]
  return (
    <>
      <PageHeader
        eyebrow="Research · Markets"
        title={`${spec.label} markets`}
        description={`Live ${spec.label.toLowerCase()} prices, the COMEX ${spec.futures[0].root} term structure, ETF premia and tracking, technicals, cross-asset comparison and liquidity. Switch metal in the top bar.`}
      />
      <RouteTabs
        items={[
          { to: '/markets', label: 'Prices', end: true },
          { to: '/markets/curve', label: 'Term structure' },
          { to: '/markets/etfs', label: 'ETFs' },
          { to: '/markets/signals', label: 'Technicals' },
          { to: '/markets/comparison', label: 'Comparison' },
          { to: '/markets/liquidity', label: 'Liquidity' },
        ]}
      />
      <Outlet />
    </>
  )
}
