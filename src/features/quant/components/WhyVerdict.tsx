import clsx from 'clsx'
import type { InstrumentDetail, QuantMode } from '@shared/quant'
import { fmtNum, fmtSigned } from '../../../design/format'
import { Chip, Panel } from '../../../ui'
import { ActionChip } from './chips'

/** Horizontal meter for a factor in [−1, 1] centred on zero (port of the CommodityFutures FactorMeter). */
export function FactorMeter({ label, value, note, na }: { label: string; value: number | null; note?: string; na?: boolean }) {
  const v = Math.max(-1, Math.min(1, value ?? 0))
  const w = Math.abs(v) * 50
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-2xs">
        <span className="label">{label}</span>
        <span className="num text-foreground/85">{na || value == null ? 'n/a' : fmtSigned(v, 2)}</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-surface-2" role="meter" aria-label={label} aria-valuemin={-1} aria-valuemax={1} aria-valuenow={na ? undefined : v}>
        <div aria-hidden className="absolute left-1/2 top-0 h-full w-px bg-muted" />
        {!na && value != null && <div aria-hidden className={clsx('absolute top-0 h-full rounded-full', v >= 0 ? 'bg-pos' : 'bg-neg')} style={v >= 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }} />}
      </div>
      {note && <p className="mt-0.5 text-2xs text-faint">{note}</p>}
    </div>
  )
}

const STANCE: Record<string, { tone: 'strong' | 'avoid' | 'neutral'; mark: string }> = {
  supports: { tone: 'strong', mark: '✓' },
  contradicts: { tone: 'avoid', mark: '✗' },
  neutral: { tone: 'neutral', mark: '·' },
  absent: { tone: 'neutral', mark: '–' },
}

/**
 * "Why this verdict": the decision, its reasons and blockers, the score's
 * driver breakdown, and how many independent lenses corroborate it.
 */
export function WhyVerdict({ d, mode }: { d: InstrumentDetail; mode: QuantMode }) {
  const v = d.verdicts[mode]
  const other = d.verdicts[mode === 'conservative' ? 'aggressive' : 'conservative']
  const s = d.score
  return (
    <Panel
      density="dense"
      title="Why this verdict"
      eyebrow={`${mode} mode`}
      actions={<ActionChip verdict={v} />}
      provenance={{ source: 'Engine decision layer (verdict.ts + decision.ts)', asOf: d.asOf }}
    >
      <p className="text-sm text-foreground">{v.instruction}.</p>
      <p className="mt-0.5 text-2xs text-muted">
        Confidence {v.confidence}. In {other.mode} mode: {other.action === 'AVOID' ? 'stand aside' : other.instruction.toLowerCase()}.
      </p>

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="label mb-1">For</h3>
          <ul className="space-y-1 text-xs text-foreground/85">
            {v.reasons.length === 0 && <li className="text-muted">Nothing in favour yet.</li>}
            {v.reasons.map((r) => (
              <li key={r} className="flex gap-2">
                <span aria-hidden className="text-pos-text">✓</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="label mb-1">Against / missing</h3>
          <ul className="space-y-1 text-xs text-foreground/85">
            {v.blockers.length === 0 && <li className="text-muted">No blockers.</li>}
            {v.blockers.map((r) => (
              <li key={r} className="flex gap-2">
                <span aria-hidden className="text-neg-text">✗</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {s && (
        <>
          <h3 className="label mb-2 mt-4">Score drivers — {fmtNum(s.score, 0)} / 100</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex items-baseline justify-between text-2xs">
                <span className="label">Stretch base</span>
                <span className="num">{fmtNum(s.base, 0)}</span>
              </div>
              <p className="mt-1 text-2xs text-faint">logistic in |z| = {fmtNum(Math.abs(s.z), 2)}; 50 at 1.5σ</p>
            </div>
            <FactorMeter label="Seasonality" value={s.seasonFactor} note="+ calendar drift agrees with the fade" />
            <FactorMeter label="Volatility regime" value={s.volFactor} note="− vol blow-up damps the score" />
            <FactorMeter label="Fundamentals" value={null} na note="none wired for this universe — neutral" />
          </div>
          {s.avoidOverride && <p className="mt-2 text-2xs text-neg-text">AVOID override: the stretch runs with the calendar and is justified.</p>}
        </>
      )}

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="label">Independent lenses</h3>
        <span className="text-2xs text-muted">
          {d.decision.headline} {d.decision.trap && <Chip tone="moderate">looks like a trade — isn&apos;t</Chip>}
        </span>
      </div>
      <ul className="mt-1.5 divide-y divide-border/60 text-xs">
        {d.decision.lenses.map((l) => (
          <li key={l.key} className="flex items-center justify-between gap-3 py-1">
            <span className="flex items-center gap-2">
              <Chip tone={STANCE[l.stance].tone}>
                {STANCE[l.stance].mark} {l.stance}
              </Chip>
              <span className="text-foreground">{l.label}</span>
            </span>
            <span className="text-right text-2xs text-muted">{l.detail}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
