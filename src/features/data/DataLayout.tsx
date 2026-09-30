import { Outlet } from 'react-router-dom'
import { PageHeader, RouteTabs } from '../../ui'

export function DataLayout() {
  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Data Center"
        description="What data the fund holds, how fresh it is, where it came from — and the controls to refresh, backfill and export it."
      />
      <RouteTabs
        items={[
          { to: '/data', label: 'Datasets', end: true },
          { to: '/data/download', label: 'Download' },
          { to: '/data/databento', label: 'Databento' },
          { to: '/data/jobs', label: 'Jobs & schedule' },
        ]}
      />
      <Outlet />
    </>
  )
}
