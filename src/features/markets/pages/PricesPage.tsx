import { RELATIVE_VALUE_PAIRS } from '@shared/universe'
import { useSettings } from '../../../store/settings-context'
import { ErrorBoundary } from '../../../ui'
import { SpotHero } from '../components/SpotHero'
import { PriceChartPanel } from '../components/PriceChartPanel'
import { EtfStrip } from '../components/EtfStrip'
import { RatioPanel } from '../components/RatioPanel'
import { assetInstruments } from '../lib/symbols'

export default function PricesPage() {
  const { asset } = useSettings()
  // Relative-value pairs the asset in focus belongs to (none: the chart takes the full width).
  const pairs = RELATIVE_VALUE_PAIRS.filter((p) => p.numerator === asset || p.denominator === asset)
  return (
    <div className="space-y-4">
      <ErrorBoundary>
        <SpotHero metal={asset} />
      </ErrorBoundary>
      <div className={pairs.length ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]' : undefined}>
        <ErrorBoundary>
          <PriceChartPanel symbols={assetInstruments(asset)} />
        </ErrorBoundary>
        {pairs.length > 0 && (
          <div className="space-y-4">
            {pairs.map((p) => (
              <ErrorBoundary key={p.id}>
                <RatioPanel pair={p} />
              </ErrorBoundary>
            ))}
          </div>
        )}
      </div>
      <ErrorBoundary>
        <EtfStrip metal={asset} />
      </ErrorBoundary>
    </div>
  )
}
