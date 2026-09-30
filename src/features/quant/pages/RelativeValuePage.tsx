import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { RelativeValueDetail } from '@shared/quant'
import { PALETTE, signColor } from '../../../design/tokens'
import { fmtNum, fmtPct, fmtSigned, fmtUsd } from '../../../design/format'
import { SpreadChart } from '../../../charts'
import { Panel, Stat } from '../../../ui'
import { useRelativeValue } from '../api'
import { QuantQuery } from '../components/QuantQuery'
import { ActionChip } from '../components/chips'
import { OuExplainer, RatioExplainer } from '../components/glossary'
import { OosPanel } from '../components/InstrumentPanels'
import { RangeControl, useRange } from '../components/Range'
import { useQuantContext } from '../QuantLayout'

export default function RelativeValuePage() {
  const q = useRelativeValue()
  return <QuantQuery q={q} rows={10}>{(rv) => <RelativeValue rv={rv} />}</QuantQuery>
}

function RelativeValue({ rv }: { rv: RelativeValueDetail }) {
  const { mode } = useQuantContext()
  const r = rv.ratio
  const s = rv.spread
  const ratioRange = useRange('5Y')
  const spreadRange = useRange('3Y')
  const ratioPts = useMemo(() => ratioRange.slice(r.series), [r.series, ratioRange])
  const spreadPts = useMemo(() => spreadRange.slice(s.series), [s.series, spreadRange])
  const prov = rv.provenance

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat size="md" label="Gold / silver ratio" value={fmtNum(r.latest, 2)} hint="oz of silver per oz of gold" />
        <Stat size="md" label="z (60d)" value={<span className={signColor(r.z === null ? null : -r.z)}>{fmtSigned(r.z, 2)}</span>} hint={r.z !== null ? (r.z > 0 ? 'silver cheap vs gold' : 'silver rich vs gold') : undefined} />
        <Stat size="md" label="z (252d)" value={fmtSigned(r.zLong, 2)} />
        <Stat size="md" label="Percentile" value={fmtPct(r.percentile, 0)} hint="of the full stored history" />
        <Stat size="md" label="OU half-life" value={r.ou?.halfLife != null ? `${fmtNum(r.ou.halfLife, 0)} d` : '—'} hint={r.ou?.tradable ? 'within 5–60 d' : 'outside the tradable band'} />
        <Stat size="md" label="Dollar-neutral hedge" value={`1 GC : ${fmtNum(r.hedge.silverContracts, 2)} SI`} hint="at today's front prices" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel density="dense" title="Gold/silver ratio" eyebrow={`${r.bandWindow}-day mean with ±1σ / ±2σ bands`} actions={<RangeControl value={ratioRange.range} onChange={ratioRange.setRange} />} provenance={prov}>
          <SpreadChart points={ratioPts} window={r.bandWindow} color={PALETTE.gold} yFormat={(v) => fmtNum(v, 1)} label="GC ÷ SI" height={300} />
        </Panel>
        <div className="space-y-4">
          <Panel density="dense" title="Ratio verdict" eyebrow={`${mode} mode`} actions={<ActionChip verdict={r.verdicts[mode]} />} provenance={{ source: 'Engine decision layer', asOf: rv.asOf }}>
            <p className="text-sm text-foreground">{r.verdicts[mode].instruction}.</p>
            <ul className="mt-2 space-y-1 text-xs">
              {r.verdicts[mode].reasons.map((x) => (
                <li key={x} className="flex gap-2">
                  <span aria-hidden className="text-pos-text">✓</span>
                  {x}
                </li>
              ))}
              {r.verdicts[mode].blockers.map((x) => (
                <li key={x} className="flex gap-2">
                  <span aria-hidden className="text-neg-text">✗</span>
                  {x}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-2xs text-muted">{r.hedge.note}</p>
            <Link to="/quant/i/GS.ratio" className="mt-2 inline-block text-xs text-brand underline underline-offset-2">
              Full analysis & trade ticket →
            </Link>
          </Panel>
          <RatioExplainer />
          <OuExplainer />
        </div>
      </div>

      <OosPanel oos={r.oos} asOf={rv.asOf} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel density="dense" title="Gold − silver dollar spread" eyebrow="100 oz gold − 5,000 oz silver (1 GC vs 1 SI), with 60-day bands" actions={<RangeControl value={spreadRange.range} onChange={spreadRange.setRange} />} provenance={prov}>
          <SpreadChart points={spreadPts} window={60} color={PALETTE.series[1]} yFormat={(v) => fmtUsd(v, 0)} label="$ spread" />
        </Panel>
        <Panel density="dense" title="Spread, normalised by volatility" actions={<ActionChip verdict={s.verdicts[mode]} />} provenance={{ source: 'Engine', asOf: rv.asOf }}>
          <div className="grid grid-cols-2 gap-4">
            <Stat size="sm" label="Spread" value={fmtUsd(s.latest, 0)} />
            <Stat size="sm" label="z (60d)" value={fmtSigned(s.z, 2)} hint="spread ÷ its own σ" />
            <Stat size="sm" label="σ (60d)" value={fmtUsd(s.sigma, 0)} hint="one standard deviation, $" />
            <Stat size="sm" label="Vol-parity ratio" value={s.volParityRatio != null ? `1 GC : ${fmtNum(s.volParityRatio, 2)} SI` : '—'} hint="equal trailing $ volatility" />
          </div>
          <p className="mt-3 text-2xs text-muted">
            1 GC and 1 SI carry very different dollar risk, so the raw spread is dominated by whichever leg is more volatile. The z-score reads it in its own σ units; the vol-parity ratio
            sizes a balanced pair. {s.verdicts[mode].instruction}.
          </p>
          <Link to="/quant/i/GS.spread" className="mt-2 inline-block text-xs text-brand underline underline-offset-2">
            Full analysis →
          </Link>
        </Panel>
      </div>
      <OosPanel oos={s.oos} asOf={rv.asOf} />
    </div>
  )
}
