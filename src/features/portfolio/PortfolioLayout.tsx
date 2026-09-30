import { Outlet } from 'react-router-dom'
import { PageHeader, RouteTabs } from '../../ui'

export function PortfolioLayout() {
  return (
    <>
      <PageHeader
        eyebrow="Fund"
        title="Portfolio"
        description="Holdings, the ledger of every entry and exit, performance and risk across ETFs, COMEX futures and allocated bullion."
      />
      <RouteTabs
        items={[
          { to: '/portfolio', label: 'Holdings', end: true },
          { to: '/portfolio/ledger', label: 'Ledger' },
          { to: '/portfolio/performance', label: 'Performance & risk' },
          { to: '/portfolio/vault', label: 'Vault' },
          { to: '/portfolio/scenario', label: 'Scenario' },
        ]}
      />
      <Outlet />
    </>
  )
}
