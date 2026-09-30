import { useMemo } from 'react'
import type { InstrumentDetail, OosView } from '@shared/quant'
import { PALETTE, METAL_COLOR, signColor } from '../../../design/tokens'
import { fmtDate, fmtNum, fmtPct, fmtSigned, fmtUsd } from '../../../design/format'
import { RegimeGateChart, SpreadChart, TimeSeriesChart } from '../../../charts'
import { Chip, Panel, Stat } from '../../../ui'
import { GateChip, OosChip, TierChip } from './chips'
import { ButterflyExplainer, ContangoExplainer, OuExplainer, StructuralExplainer, ZScoreExplainer } from './glossary'
import { RangeControl, useRange } from './Range'
import { valueFormatter } from '../format'

/** Value with rolling mean ±1σ/±2σ bands (the z picture), with a range selector. */
export function ZBandPanel({ d, title }: { d: InstrumentDetail; title?: string }) {
  const { range, setRange, slice } = useRange(d.kind === 'ratio' ? '5Y' : '3Y')
  const points = useMemo(() => slice(d.series), [d.series, slice])
  const last = d.series[d.series.length - 1]
  return (
    <Panel
      density="dense"
      title={title ?? `${d.label} — value & z-bands`}
      eyebrow={`${d.unit} · ${d.bandWindow}-day bands`}
      actions={<RangeControl value={range} onChange={setRange} />}
      provenance={{ ...d.provenance, note: d.kind === 'seasonal' ? 'Current season only' : undefined }}
    >
      {points.length > 1 ? (
        <SpreadChart points={points} window={d.bandWindow} color={METAL_COLOR[d.metal]} yFormat={valueFormatter(d.unit)} label={d.kind === 'seasonal' ? 'this season' : 'value'} />
      ) : (
        <p className="py-8 text-center text-xs text-muted">This spread is not trading yet this season.</p>
      )}
      {last && (
        <p className="mt-2 text-2xs text-muted">
          Latest {fmtDate(last.date)}: {valueFormatter(d.unit)(last.value)} · mean {last.mean == null ? '—' : valueFormatter(d.unit)(last.mean)} · z {fmtSigned(last.z, 2)}
        </p>
      )}
    </Panel>
  )
}

/** The signal numbers: z, effective z, score, OU fit, carry, gates. */
export function SignalStats({ d }: { d: InstrumentDetail }) {
  const s = d.score
  const ou = d.ou
  const c = d.carry
  return (
    <Panel density="dense" title="Signal" eyebrow="Stretch · reversion · carry" provenance={{ source: 'Engine (score.ts, ou.ts, carry.ts)', asOf: d.asOf }}>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
        <Stat size="sm" label="z (60d)" value={<span className={signColor(s ? -s.z : null)}>{fmtSigned(s?.z, 2)}</span>} hint={s ? (s.z > 0 ? 'rich → fade short' : s.z < 0 ? 'cheap → fade long' : 'at mean') : undefined} />
        <Stat size="sm" label="Effective z" value={fmtSigned(ou?.zEff, 2)} hint={ou?.nEff ? `lookback ${ou.nEff}d (3 × half-life)` : undefined} />
        <Stat size="sm" label="Score" value={s ? fmtNum(s.score, 0) : '—'} hint={s ? <TierChip tier={s.tier} /> : undefined} />
        <Stat size="sm" label="QT rank" value={fmtNum(d.qtRank, 1)} hint="fixed-weight composite" />
        <Stat size="sm" label="OU half-life" value={ou?.halfLife != null ? `${fmtNum(ou.halfLife, 1)} d` : '—'} hint={ou ? `b ${fmtNum(ou.b, 4)} · R² ${fmtNum(ou.r2, 3)}` : 'no fit'} />
        <Stat size="sm" label="Reversion ETA" value={ou?.expectedDays != null ? `${fmtNum(ou.expectedDays, 0)} d` : '—'} hint="to |z| = 0.5" />
        <Stat size="sm" label="Curve" value={c ? c.regime : '—'} hint={c ? `slope ${fmtNum(c.slope, 2)} · ${c.slopePctile != null ? `${fmtPct(c.slopePctile, 0)} pctile` : 'pctile n/a'}` : 'not applicable'} />
        <Stat size="sm" label="Slope momentum" value={fmtSigned(c?.slopeMomZ, 2)} hint={c?.trending ? 'trending — veto' : 'calm'} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <GateChip ok={d.gates.ouTradable} label="OU" na={d.kind === 'seasonal'} />
        <GateChip ok={d.carry ? !d.gates.carryConflict : null} label="Carry" />
        <GateChip ok={d.gates.structural === null ? null : !d.gates.structural} label="Structural" />
        <OosChip status={d.oos.status} fragile={d.oos.regime ? !d.oos.regime.survives && d.oos.status === 'passed' : null} />
      </div>
      {ou && <p className="mt-2 text-2xs text-muted">{ou.reason}</p>}
      {c?.detail && <p className="mt-0.5 text-2xs text-muted">Carry: {c.detail}</p>}
      {d.gates.structuralDetail && <p className="mt-0.5 text-2xs text-muted">Structural: {d.gates.structuralDetail}</p>}
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <ZScoreExplainer />
        <OuExplainer />
      </div>
    </Panel>
  )
}

export function StructuralPanel({ d }: { d: InstrumentDetail }) {
  if (!d.structural || d.structural.points.length < 2) return null
  const now = d.gates.structural
  return (
    <Panel
      density="dense"
      title="Structural-move gate"
      eyebrow={`Front outright & curve slope vs ${d.structural.n}-day noise bands`}
      actions={<Chip tone={now ? 'avoid' : 'strong'}>{now ? 'breakout — stand aside' : 'in band — normal regime'}</Chip>}
      provenance={{ source: 'Engine (regimeFilter.ts) on the stitched curve', asOf: d.asOf }}
    >
      <RegimeGateChart points={d.structural.points} k={d.structural.k} />
      <div className="mt-2">
        <StructuralExplainer />
      </div>
    </Panel>
  )
}

export function CurvaturePanel({ d }: { d: InstrumentDetail }) {
  const { range, setRange, slice } = useRange('3Y')
  const pts = useMemo(() => slice(d.curvature ?? []), [d.curvature, slice])
  const series = useMemo(() => [{ key: 'c', label: 'curvature (bow)', values: pts.map((p) => p.value), color: PALETTE.series[1], width: 1.4 }], [pts])
  const zero = useMemo(() => [{ value: 0, label: 'straight line', color: PALETTE.muted }], [])
  if (!d.curvature || d.curvature.length < 2) return null
  const last = d.curvature[d.curvature.length - 1]
  return (
    <Panel
      density="dense"
      title="Curvature — the bow of the middle month"
      eyebrow={`mid − (near + far) ÷ 2 · now ${fmtNum(last.value, 3)} ${d.unit}`}
      actions={<RangeControl value={range} onChange={setRange} />}
      provenance={{ source: 'Derived from the butterfly value (= −2 × curvature)', asOf: d.asOf }}
    >
      <TimeSeriesChart dates={pts.map((p) => p.date)} series={series} refLines={zero} height={200} yFormat={(v) => fmtNum(v, 2)} ariaLabel="Butterfly curvature over time" />
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <ButterflyExplainer />
        <ContangoExplainer />
      </div>
    </Panel>
  )
}

/** Walk-forward out-of-sample result with regime robustness and per-year P&L. */
export function OosPanel({ oos, asOf }: { oos: OosView; asOf: string }) {
  const maxAbs = Math.max(1, ...oos.yearly.map((y) => Math.abs(y.netPnl)))
  return (
    <Panel
      density="dense"
      title="Out-of-sample validation"
      eyebrow={oos.method === 'seasonal-window' ? 'Walk-forward: best window on prior years, traded blind on the next' : 'Walk-forward: fade |z| ≥ 1.5 using trailing data only'}
      actions={<OosChip status={oos.status} fragile={oos.regime ? !oos.regime.survives && oos.status === 'passed' : null} />}
      provenance={{ source: 'Engine (walkForward.ts / flyWalkForward.ts, regimes.ts)', asOf, note: oos.pnlUnit }}
    >
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
        <Stat size="sm" label="OOS years" value={oos.trades} />
        <Stat size="sm" label="Win rate" value={fmtPct(oos.winRate, 0)} />
        <Stat size="sm" label="Avg / yr" value={fmtUsd(oos.avgPnl, 0)} />
        <Stat size="sm" label="t-stat" value={fmtNum(oos.tStat, 2)} />
        <Stat size="sm" label="Sharpe (per trade)" value={fmtNum(oos.sharpe, 2)} />
        <Stat size="sm" label="Max drawdown" value={fmtUsd(oos.maxDrawdown, 0)} />
      </div>
      <p className="mt-2 text-2xs text-muted">{oos.reason}</p>
      {oos.regime && (
        <p className="mt-1 text-2xs text-muted">
          Regime robustness: {oos.regime.note}
          {oos.regime.regimesHit.length > 0 && ` (${oos.regime.regimesHit.join(', ')})`}
        </p>
      )}
      {oos.yearly.length > 0 && (
        <ul className="mt-3 space-y-1" aria-label="Out-of-sample P&L by year">
          {oos.yearly.map((y) => (
            <li key={y.year} className="grid grid-cols-[3rem_1fr_5rem] items-center gap-2 text-2xs">
              <span className="num text-muted">{y.year}</span>
              <span className="relative h-2 rounded-sm bg-surface-2">
                <span
                  aria-hidden
                  className="absolute top-0 h-full rounded-sm"
                  style={{
                    background: y.netPnl >= 0 ? PALETTE.pos : PALETTE.neg,
                    left: y.netPnl >= 0 ? '50%' : `${50 - (Math.abs(y.netPnl) / maxAbs) * 50}%`,
                    width: `${(Math.abs(y.netPnl) / maxAbs) * 50}%`,
                  }}
                />
              </span>
              <span className={`num text-right ${signColor(y.netPnl)}`}>{fmtUsd(y.netPnl, 0)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
