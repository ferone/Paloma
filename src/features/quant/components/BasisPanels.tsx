import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import type { BasisView, InstrumentDetail, QuantMode } from '@shared/quant'
import { ASSET_COLOR, PALETTE, signColor } from '../../../design/tokens'
import { fmtDate, fmtNum, fmtSigned, fmtUsd } from '../../../design/format'
import { ChartLegend, SpreadChart, TimeSeriesChart } from '../../../charts'
import { Chip, Explainer, HelpTip, Panel, Stat } from '../../../ui'
import { ActionChip, OosChip } from './chips'
import { RangeControl, useRange } from './Range'

// The cash-and-carry basis views: annualized basis vs the T-bill, the excess-carry
// z bands, the headline numbers and a ticket sized in bp of carry and $ per contract.

const pctPa = (v: number | null | undefined, dp = 2) => (v == null ? '—' : `${fmtNum(v, dp)}%`)
const bpText = (v: number | null | undefined) => (v == null ? '—' : `${fmtNum(v, 0)} bp`)

/** Trailing mean over `n` points (null until the window fills). */
function trailingMean(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= n) sum -= values[i - n]
    out.push(i + 1 >= n ? sum / n : null)
  }
  return out
}

/** Annualized basis (daily, and its 20-day mean) against the T-bill. */
export function BasisVsBillPanel({ d, height = 260 }: { d: InstrumentDetail; height?: number }) {
  const b = d.basis as BasisView
  const { range, setRange, slice } = useRange('1Y')
  // The mean is computed on the full history so it is valid from the first visible date.
  const withMean = useMemo(() => {
    const m = trailingMean(
      b.points.map((p) => p.basis),
      20,
    )
    return b.points.map((p, i) => ({ ...p, mean: m[i] }))
  }, [b.points])
  const pts = useMemo(() => slice(withMean), [withMean, slice])
  const color = ASSET_COLOR[d.metal]
  const series = useMemo(
    () => [
      { key: 'daily', label: 'basis (daily)', values: pts.map((p) => p.basis), color, width: 1, opacity: 0.35 },
      { key: 'mean', label: 'basis (20-day mean)', values: pts.map((p) => p.mean), color, width: 1.6 },
      { key: 'bill', label: b.rateLabel, values: pts.map((p) => p.tbill), color: PALETTE.muted, width: 1.4, dash: '4 3' },
    ],
    [pts, color, b.rateLabel],
  )
  const zero = useMemo(() => [{ value: 0, color: PALETTE.faint }], [])
  return (
    <Panel
      density="dense"
      title="Annualized basis vs the T-bill"
      eyebrow={`(F ÷ S − 1) × 365 ÷ days to last trade · ${b.root} front vs ${b.spotSymbol}`}
      actions={<RangeControl value={range} onChange={setRange} />}
      provenance={d.provenance}
    >
      <figure>
        <TimeSeriesChart
          dates={pts.map((p) => p.date)}
          series={series}
          refLines={zero}
          height={height}
          yFormat={(v) => `${fmtNum(v, 0)}%`}
          ariaLabel={`Annualized ${b.root} basis against the ${b.rateLabel}`}
          tooltipExtra={(i) => [
            { label: 'excess carry', value: pctPa(pts[i]?.excess) },
            { label: 'contract', value: `${pts[i]?.contract ?? '—'} · ${pts[i]?.daysToExpiry ?? '—'} d` },
          ]}
        />
        <ChartLegend
          items={[
            { label: 'Basis, daily', color, faint: true },
            { label: 'Basis, 20-day mean', color },
            { label: `${b.rateLabel} (${b.rateSymbol})`, color: PALETTE.muted, dash: true },
          ]}
        />
      </figure>
      <p className="mt-2 text-2xs text-muted">
        The gap between the two lines is the excess carry. Daily points are noisy: the spot close ({b.spotSymbol}, 00:00 UTC) is a few hours after the CME settlement, and
        the annualization magnifies small gaps as expiry nears.
      </p>
    </Panel>
  )
}

/** Excess carry with its rolling mean and ±1σ/±2σ bands (the z the engine fades). */
export function ExcessCarryBandsPanel({ d, height = 240 }: { d: InstrumentDetail; height?: number }) {
  const { range, setRange, slice } = useRange('1Y')
  const pts = useMemo(() => slice(d.series), [d.series, slice])
  const last = d.series[d.series.length - 1]
  return (
    <Panel
      density="dense"
      title="Excess carry and its z-bands"
      eyebrow={`basis − T-bill, % p.a. · ${d.bandWindow}-day mean with ±1σ / ±2σ`}
      actions={<RangeControl value={range} onChange={setRange} />}
      provenance={d.provenance}
    >
      <SpreadChart points={pts} window={d.bandWindow} color={ASSET_COLOR[d.metal]} yFormat={(v) => `${fmtNum(v, 0)}%`} label="excess carry" height={height} />
      {last && (
        <p className="mt-2 text-2xs text-muted">
          Latest {fmtDate(last.date)}: {pctPa(last.value)} · mean {pctPa(last.mean)} · z {fmtSigned(last.z, 2)}. Above the bands the carry is rich (harvest it); below, cheap (stand aside).
        </p>
      )}
    </Panel>
  )
}

/** Headline numbers: basis, T-bill, excess, z, half-life, front contract, carry to expiry. */
export function BasisStats({ d, size = 'md' }: { d: InstrumentDetail; size?: 'sm' | 'md' }) {
  const b = d.basis as BasisView
  const l = b.latest
  const z = d.score?.z ?? null
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
      <Stat size={size} label="Basis" value={pctPa(l.basis)} hint={`${l.contract} vs ${b.spotSymbol}, annualized`} />
      <Stat size={size} label={b.rateLabel} value={pctPa(l.tbill)} hint={b.rateSymbol} />
      <Stat size={size} label="Excess carry" value={<span className={signColor(l.excess)}>{pctPa(l.excess)}</span>} hint={`${fmtSigned(l.excess * 100, 0)} bp over cash`} />
      <Stat size={size} label={`z (${d.bandWindow}d)`} value={fmtSigned(z, 2)} hint={z == null ? undefined : z > 0 ? 'rich: harvest' : z < 0 ? 'cheap: stand aside' : 'at mean'} />
      <Stat size={size} label="OU half-life" value={d.ou?.halfLife != null ? `${fmtNum(d.ou.halfLife, 1)} d` : '—'} hint={d.ou?.tradable ? 'within 5–60 d' : 'outside the tradable band'} />
      <Stat size={size} label="Front" value={l.contract} hint={`${l.daysToExpiry} d to last trade${b.lastTrade ? ` (${fmtDate(b.lastTrade)})` : ''}`} />
      <Stat size={size} label="$ per bp" value={fmtUsd(b.dollarsPerBp, 2)} hint={`per contract (${fmtNum(b.contractSize, 0)} ${b.priceUnit})`} />
      <Stat size={size} label="Excess to expiry" value={<span className={signColor(b.excessCarryUsd)}>{fmtUsd(b.excessCarryUsd, 0)}</span>} hint="per contract, over the T-bill" />
    </div>
  )
}

function Metric({ k, v, help, className }: { k: string; v: string; help?: string; className?: string }) {
  return (
    <div>
      <div className="label">{help ? <HelpTip term={k}>{help}</HelpTip> : k}</div>
      <div className={clsx('num mt-0.5 text-sm text-foreground', className)}>{v}</div>
    </div>
  )
}

/** The carry trade as one ticket: legs, levels in bp of annualized carry, $ per contract. */
export function BasisTicket({ d, mode }: { d: InstrumentDetail; mode: QuantMode }) {
  const b = d.basis as BasisView
  const p = d.plan
  const v = d.verdicts[mode]
  return (
    <Panel
      density="dense"
      title="Carry trade ticket"
      eyebrow={v.action !== 'AVOID' ? 'Actionable in this mode' : 'The trade, if taken (the verdict says stand aside)'}
      actions={<ActionChip verdict={v} />}
      provenance={{ source: 'Engine trade plan (basis.ts); OOS figures from the walk-forward', asOf: d.asOf, modeled: true, note: 'Estimate, not a guarantee' }}
    >
      <ul className="mb-3 flex flex-wrap gap-1.5" aria-label="Legs">
        <li>
          <Chip tone="strong">
            buy {fmtNum(b.contractSize, 0)} {b.priceUnit} spot ({b.spotSymbol})
          </Chip>
        </li>
        <li>
          <Chip tone="avoid">sell 1 {b.latest.contract}</Chip>
        </li>
      </ul>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Metric k="Entry" v={bpText(p.entry)} help="Today's excess carry, in bp of annualized return over the T-bill." />
        <Metric k="Target" v={bpText(p.target)} help={`The ${d.bandWindow}-day mean of the excess carry: where a rich basis reverts to.`} />
        <Metric k="Stop" v={bpText(p.stop)} help="Where the realistic loss is hit: the out-of-sample max drawdown when available, else 2σ adverse." />
        <Metric k="$ per bp" v={fmtUsd(p.pointValue, 2)} help={`${fmtNum(b.contractSize, 0)} ${b.priceUnit} × spot × days to expiry ÷ 365 ÷ 10,000: one bp of annualized basis, per contract, today.`} />
        <Metric k="Reversion $" v={fmtUsd(p.side === 0 ? null : p.expectedUsd, 0)} className={signColor(p.side === 0 ? null : p.expectedUsd)} help="(entry − target) bp × $ per bp, if the carry reverts to its mean." />
        <Metric k="Risk $" v={fmtUsd(p.side === 0 ? null : p.riskUsd, 0)} className="text-neg-text" />
        <Metric k="Basis to expiry" v={fmtUsd(b.grossCarryUsd, 0)} help="(F − S) × contract size: locked in if both legs are held to the final settlement." />
        <Metric k="Funding" v={fmtUsd(-b.fundingUsd, 0)} className="text-neg-text" help="Spot × T-bill × days ÷ 365 × contract size: the cash tied up in the spot leg." />
        <Metric k="Excess to expiry" v={fmtUsd(b.excessCarryUsd, 0)} className={signColor(b.excessCarryUsd)} help="Basis to expiry minus funding: the return over cash, per contract." />
        <Metric k="OOS win rate" v={d.oos.trades ? `${fmtNum(d.oos.winRate * 100, 0)}%` : '—'} />
        <Metric k="OOS avg / trade" v={d.oos.trades ? bpText(d.oos.avgPnl) : '—'} help={d.oos.pnlUnit} />
        <Metric k="Half-Kelly" v={p.kelly ? `${fmtNum(p.kelly.halfKelly * 100, 1)}%` : '—'} help={p.kelly?.note ?? 'Needs ≥ 5 out-of-sample trades with both wins and losses.'} />
      </div>
      <p className="mt-3 border-t border-border pt-2 text-2xs text-muted">{p.note}</p>
    </Panel>
  )
}

export function BasisExplainer({ settlement }: { settlement: string }) {
  return (
    <Explainer title="What is the cash-and-carry basis?">
      <p>
        A cash-settled future converges to spot at expiry, so buying spot and selling the future locks in today&apos;s gap. Annualized, (F ÷ S − 1) × 365 ÷ days, it is a
        rate of return. Compared with the 13-week T-bill, the difference is the <strong>excess carry</strong>: what the trade earns over holding cash.
      </p>
      <p>
        It is a <strong>carry harvest, not a directional bet</strong>: long spot against a short future is flat the asset. The engine fades the excess carry like a spread,
        harvesting when it is rich (z high) and standing aside or unwinding when it is cheap, because the reverse trade (short spot) is not one this fund runs.
      </p>
      <p>
        Risks: <strong>funding</strong> above the T-bill eats the excess; the short future draws <strong>margin calls in spikes</strong> while the spot gain sits unrealised; and
        the future settles to the {settlement}, which an ETF or exchange spot leg only <strong>tracks</strong>, not matches.
      </p>
    </Explainer>
  )
}

/** Compact basis summary for the Relative-value page. */
export function BasisSummary({ d, mode }: { d: InstrumentDetail; mode: QuantMode }) {
  const v = d.verdicts[mode]
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-4">
        <BasisStats d={d} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <BasisVsBillPanel d={d} height={280} />
        <div className="space-y-4">
          <Panel
            density="dense"
            title="Basis verdict"
            eyebrow={`${mode} mode`}
            actions={
              <div className="flex gap-1.5">
                <OosChip status={d.oos.status} fragile={d.oos.regime ? !d.oos.regime.survives && d.oos.status === 'passed' : null} />
                <ActionChip verdict={v} />
              </div>
            }
            provenance={{ source: 'Engine decision layer', asOf: d.asOf }}
          >
            <p className="text-sm text-foreground">{v.instruction}.</p>
            <ul className="mt-2 space-y-1 text-xs">
              {v.reasons.map((x) => (
                <li key={x} className="flex gap-2">
                  <span aria-hidden className="text-pos-text">
                    ✓
                  </span>
                  {x}
                </li>
              ))}
              {v.blockers.map((x) => (
                <li key={x} className="flex gap-2">
                  <span aria-hidden className="text-neg-text">
                    ✗
                  </span>
                  {x}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-2xs text-muted">{d.plan.note}</p>
            <Link to={`/quant/i/${encodeURIComponent(d.id)}`} className="mt-2 inline-block text-xs text-brand underline underline-offset-2">
              Full analysis & carry ticket →
            </Link>
          </Panel>
          <BasisExplainer settlement={(d.basis as BasisView).settlement} />
        </div>
      </div>
      <ExcessCarryBandsPanel d={d} />
    </div>
  )
}
