import { ASSETS } from '@shared/universe'
import { useSettings } from '../../../store/settings-context'
import { ErrorNote, Explainer, Panel, PanelSkeleton } from '../../../ui'
import { useMlPredictions } from '../api'
import { JobControls } from '../components/JobControls'
import { OosPanel } from '../components/OosPanel'
import { SignalCard } from '../components/SignalCard'
import { useAssistantContext } from '../../assistant/context'
import { mlSignalSummary } from '../../assistant/summaries'

export default function SignalPage() {
  const { asset } = useSettings()
  const preds = useMlPredictions()
  useAssistantContext(() => mlSignalSummary(preds.data, asset), [preds.data, asset])
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

      <OosPanel asset={asset} />

      <Panel title="Model jobs" density="dense">
        <JobControls />
      </Panel>

      <Explainer title="What this signal is, and what it is not">
        <p>
          For each asset, a classifier estimates the probability that its reference price (the front-month futures close for metals) is
          higher 20 trading days from now. The model is gradient-boosted trees or a regularized logistic regression, whichever the asset&rsquo;s
          own training data favours. It trains on the whole price history (back to 2000 where Yahoo has it). The inputs are momentum,
          volatility, trend, the dollar, 10-year yields, VIX, equities and seasonality, plus a relative-value ratio where the asset has a
          pair (gold/silver). Feeds that start later are added where they exist: benchmark-ETF volume, real yields and breakevens,
          speculator COT positioning, futures open interest and the futures curve.
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
