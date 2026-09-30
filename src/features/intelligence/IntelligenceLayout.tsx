import { Outlet } from 'react-router-dom'
import { UNIVERSE } from '@shared/universe'
import { useSettings } from '../../store/settings-context'
import { PageHeader, RouteTabs } from '../../ui'

export function IntelligenceLayout() {
  // Asset in focus comes from the global switch in the top bar.
  const { asset } = useSettings()
  return (
    <>
      <PageHeader
        eyebrow={`Research · ${UNIVERSE[asset].label}`}
        title="Intelligence"
        description="A 20-day direction model per asset, shown with its walk-forward validation. It counts only when it passes."
      />
      <RouteTabs
        items={[
          { to: '/intelligence', label: 'Signal', end: true },
          { to: '/intelligence/validation', label: 'Validation' },
          { to: '/intelligence/features', label: 'Features' },
          { to: '/intelligence/calibration', label: 'Calibration' },
          { to: '/intelligence/runs', label: 'Runs' },
        ]}
      />
      <Outlet />
    </>
  )
}
