import { Outlet } from 'react-router-dom'
import { METALS, UNIVERSE } from '@shared/universe'
import { useSettings } from '../../store/settings-context'
import { PageHeader, RouteTabs, Segmented } from '../../ui'

export function IntelligenceLayout() {
  const { metal, setMetal } = useSettings()
  return (
    <>
      <PageHeader
        eyebrow="Research"
        title="Intelligence"
        description="A 20-day direction model per metal, shown with its walk-forward validation. It counts only when it passes."
        actions={
          <Segmented
            ariaLabel="Metal"
            size="md"
            value={metal}
            onChange={setMetal}
            options={METALS.map((m) => ({ value: m, label: UNIVERSE[m].label }))}
          />
        }
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
