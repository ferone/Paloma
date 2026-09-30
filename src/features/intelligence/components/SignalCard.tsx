import clsx from 'clsx'
import { ML_GATE, type MlPrediction } from '@shared/ml'
import { UNIVERSE, type AssetId } from '@shared/universe'
import { PALETTE, signColor } from '../../../design/tokens'
import { fmtDate, fmtNum, fmtPct, fmtPctSigned } from '../../../design/format'
import { EmptyState, HelpTip, Panel } from '../../../ui'
import { ValidationChip } from './common'

/** Horizontal 0–100% scale with the 50% line, the historical band and the point estimate. */
function ProbabilityScale({ p, lo, hi, muted }: { p: number; lo: number | null; hi: number | null; muted: boolean }) {
  const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`
  return (
    <div className="relative mt-3 h-2 rounded-full bg-surface-2" aria-hidden>
      {lo != null && hi != null && (
        <div className="absolute inset-y-0 rounded-full" style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})`, background: PALETTE.border }} />
      )}
      <div className="absolute -top-1 bottom-[-4px] w-px" style={{ left: '50%', background: PALETTE.muted }} />
      <div
        className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded-sm"
        style={{ left: pct(p), background: muted ? PALETTE.faint : PALETTE.brand }}
      />
    </div>
  )
}

/** "Gold · GC front month"; assets without futures fall back to their reference symbol. */
function eyebrowOf(asset: AssetId): string {
  const spec = UNIVERSE[asset]
  const root = spec.futures[0]?.root
  return root ? `${spec.label} · ${root} front month` : `${spec.label} · ${spec.spot}`
}

export function SignalCard({ metal, prediction }: { metal: AssetId; prediction: MlPrediction | undefined }) {
  if (!prediction) {
    return (
      <Panel eyebrow={eyebrowOf(metal)} title="20-day direction">
        <EmptyState title="No prediction yet" compact>
          Train the model or run inference below. Nothing is shown until a model has been validated and scored.
        </EmptyState>
      </Panel>
    )
  }
  const validated = prediction.validationStatus === 'passed'
  return (
    <Panel
      eyebrow={eyebrowOf(metal)}
      title="20-day direction"
      actions={<ValidationChip status={prediction.validationStatus} />}
      provenance={{
        source: `Model run #${prediction.runId} · trained ${fmtDate(prediction.trainedAt)}`,
        asOf: prediction.date,
        note: `scored ${fmtDate(prediction.createdAt)}`,
      }}
    >
      {!validated && (
        <p className="mb-3 rounded-md border border-border bg-surface-2/60 px-3 py-2 text-xs text-muted">
          <span className="font-medium text-foreground">Not validated — informational only.</span>{' '}
          {prediction.reasons.length ? `Gate: ${prediction.reasons.join('; ')}.` : 'The model has not been tested out of sample.'}
        </p>
      )}

      <div className="label">
        <HelpTip term="P(up over 20 trading days)">
          The model&rsquo;s calibrated probability that the front-month close is higher 20 trading days after {fmtDate(prediction.date)}.
        </HelpTip>
      </div>
      <div className={clsx('num mt-1 leading-none', validated ? 'text-[2.5rem] text-foreground' : 'text-[1.75rem] text-muted')}>
        {fmtPct(prediction.pUp, 1)}
      </div>
      <ProbabilityScale p={prediction.pUp} lo={prediction.pUpLow} hi={prediction.pUpHigh} muted={!validated} />
      <p className="mt-2 text-2xs leading-relaxed text-muted">
        {prediction.pUpLow != null && prediction.pUpHigh != null ? (
          <>
            Out of sample, when the model gave a similar probability, {UNIVERSE[metal].label.toLowerCase()} rose{' '}
            <span className="num text-foreground">{fmtPct(prediction.pUpLow, 1)}–{fmtPct(prediction.pUpHigh, 1)}</span> of the time (80% interval).
          </>
        ) : (
          'Too few out-of-sample cases at this probability to give a historical band.'
        )}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4">
        <div>
          <div className="label">Expected 20d move</div>
          <div className={clsx('num mt-1 text-xl', validated ? signColor(prediction.expectedMove) : 'text-muted')}>
            {fmtPctSigned(prediction.expectedMove, 1)}
          </div>
        </div>
        <div>
          <div className="label">
            <HelpTip term="10th–90th pct">Spread of out-of-sample errors of the move regressor, added to its estimate.</HelpTip>
          </div>
          <div className="num mt-1 text-xl text-muted">
            {fmtPctSigned(prediction.lower, 1)} <span className="text-faint">to</span> {fmtPctSigned(prediction.upper, 1)}
          </div>
        </div>
      </div>

      <p className="mt-4 text-2xs leading-relaxed text-faint">
        A statistical estimate from price, cross-asset and seasonal features — not advice. It passes only if walk-forward AUC ≥{' '}
        {fmtNum(ML_GATE.auc, 2)}, hit rate ≥ {fmtPct(ML_GATE.hit, 0)}, permutation p &lt; {fmtNum(ML_GATE.pValue, 2)} and it beats a
        logistic baseline. Past validation does not guarantee future accuracy.
      </p>
    </Panel>
  )
}
