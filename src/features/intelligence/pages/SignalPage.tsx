import { ASSETS } from '@shared/universe'
import { useSettings } from '../../../store/settings-context'
import { ErrorNote, Explainer, Panel, PanelSkeleton } from '../../../ui'
import { useMlPredictions } from '../api'
import { JobControls } from '../components/JobControls'
import { SignalCard } from '../components/SignalCard'

export default function SignalPage() {
  const { asset } = useSettings()
  const preds = useMlPredictions()
  // Selected asset first; every asset is shown so they can be compared.
  const order = [asset, ...ASSETS.filter((m) => m !== asset)]

  return (
    <div className="space-y-6">
      {preds.isLoading ? (
        <Panel><PanelSkeleton rows={6} /></Panel>
      ) : preds.error ? (
        <Panel><ErrorNote error={preds.error} onRetry={() => preds.refetch()} /></Panel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {order.map((m) => (
            <SignalCard key={m} metal={m} prediction={preds.data?.find((p) => p.metal === m)} />
          ))}
        </div>
      )}

      <Panel title="Model jobs" density="dense">
        <JobControls />
      </Panel>

      <Explainer title="What this signal is, and what it is not">
        <p>
          For each asset, a gradient-boosted classifier estimates the probability that its reference price (the front-month futures
          close for metals) is higher 20 trading days from now. The inputs are momentum, volatility, trend, the dollar, 10-year yields,
          VIX, equities, benchmark-ETF volume and seasonality; a relative-value ratio where the asset has a pair (gold/silver); plus real
          yields, speculator COT positioning and the futures curve once those feeds are loaded.
        </p>
        <p>
          The probability should be <strong>calibrated</strong>: across past out-of-sample predictions, readings near 60% should have come true
          about 60% of the time. The Calibration tab checks this. The band under the number is what actually happened historically when
          the model gave a similar reading.
        </p>
        <p>
          The model is <strong>validated</strong> by retraining it each year on past data only, testing it on the following year, and
          checking that its edge beats label-shuffled models. Until it passes, the number is shown muted and must not drive decisions.
        </p>
      </Explainer>
    </div>
  )
}
