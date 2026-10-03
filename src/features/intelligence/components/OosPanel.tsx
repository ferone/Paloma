import { UNIVERSE, type AssetId } from '@shared/universe'
import { fmtNum, fmtPct } from '../../../design/format'
import { PALETTE } from '../../../design/tokens'
import { EmptyState, ErrorNote, Panel, PanelSkeleton, Stat } from '../../../ui'
import { useLatestRun } from '../api'
import { OosHistory } from './charts'
import { ValidationChip } from './common'
import { devicesShort, fmtDuration, fmtSpan } from './compute'
import { runProvenance } from './provenance'

/** Full-span walk-forward record of the latest run for one asset: what the model said each test day vs what happened. */
export function OosPanel({ asset }: { asset: AssetId }) {
  const { run, isLoading, error, refetch } = useLatestRun(asset)
  const label = UNIVERSE[asset].label
  if (isLoading) return <Panel><PanelSkeleton rows={5} /></Panel>
  if (error) return <Panel><ErrorNote error={error} onRetry={refetch} /></Panel>
  const m = run?.metrics
  const oos = m?.oos
  if (!run || !m || !oos || oos.p.length === 0) {
    return (
      <Panel title={`${label}: out-of-sample record`}>
        <EmptyState title="No per-day out-of-sample record yet">
          Runs trained by the current pipeline store every walk-forward test day. Retrain {label.toLowerCase()} to see its full history here.
        </EmptyState>
      </Panel>
    )
  }
  const n = oos.p.length
  const hits = oos.p.reduce((a, p, i) => a + ((p > 0.5 ? 1 : 0) === oos.y[i] ? 1 : 0), 0)
  const span = m.span
  const compute = m.compute
  return (
    <Panel
      eyebrow="Walk-forward, out of sample"
      title={<span className="inline-flex flex-wrap items-center gap-2">{label}: what the model said vs what happened <ValidationChip status={run.validationStatus} /></span>}
      provenance={{ source: runProvenance(run) }}
    >
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat size="sm" label="Test days" value={(span?.oosRows ?? n).toLocaleString('en-US')} hint={span?.testFrom ? `${span.testFrom}–${span.testTo}` : undefined} />
        <Stat size="sm" label="Pooled AUC" value={fmtNum(m.summary.pooledAuc, 3)} hint={`mean per year ${fmtNum(m.summary.auc, 3)}`} />
        <Stat size="sm" label="Hit rate" value={fmtPct(hits / n, 1)} hint="P(up) above 50% matched" />
        <Stat size="sm" label="Trained on" value={fmtSpan(span?.from ?? m.dataFrom, span?.to ?? m.labelThrough)} hint={`${(span?.rows ?? m.nRows).toLocaleString('en-US')} labeled days`} />
        <Stat size="sm" label="Compute" value={fmtDuration(compute?.timings.wallSec ?? m.durationSec)} hint={devicesShort(compute?.devices) ?? 'CPU (older run)'} />
      </div>
      <OosHistory oos={oos} />
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
        <span><span className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: PALETTE.brand }} />P(up), quarterly mean (63 test days)</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm align-middle" style={{ background: PALETTE.brand, opacity: 0.2 }} />daily range</span>
        <span><span className="mr-1 inline-block w-3 border-t border-dashed align-middle" style={{ borderColor: PALETTE.muted }} />realized up share, quarterly mean</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm align-middle" style={{ background: PALETTE.pos }} />/<span className="mx-1 inline-block h-2 w-3 rounded-sm align-middle" style={{ background: PALETTE.neg }} />20 days later the price was mostly up / down</span>
      </p>
      <p className="mt-2 text-2xs text-muted">
        Each test year is predicted by a model trained only on earlier years (the last 20 training days dropped), so every point is a
        forecast the model could have made at the time.{oos.step > 1 ? ` Shown every ${oos.step}th day.` : ''} A useful model&rsquo;s line
        rises before the strip turns green and falls before it turns red; a line hugging 0.50 is a model with nothing to say.
      </p>
    </Panel>
  )
}
