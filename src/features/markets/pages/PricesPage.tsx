import { useSettings } from '../../../store/settings-context'
import { ErrorBoundary } from '../../../ui'
import { SpotHero } from '../components/SpotHero'
import { PriceChartPanel } from '../components/PriceChartPanel'
import { EtfStrip } from '../components/EtfStrip'
import { RatioPanel } from '../components/RatioPanel'
import { metalInstruments } from '../lib/symbols'

export default function PricesPage() {
  const { metal } = useSettings()
  return (
    <div className="space-y-4">
      <ErrorBoundary>
        <SpotHero metal={metal} />
      </ErrorBoundary>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <ErrorBoundary>
          <PriceChartPanel symbols={metalInstruments(metal)} />
        </ErrorBoundary>
        <ErrorBoundary>
          <RatioPanel />
        </ErrorBoundary>
      </div>
      <ErrorBoundary>
        <EtfStrip metal={metal} />
      </ErrorBoundary>
    </div>
  )
}
