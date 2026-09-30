import clsx from 'clsx'
import type { InstrumentDetail, QuantMode } from '@shared/quant'
import { fmtNum, fmtPct, fmtUsd } from '../../../design/format'
import { signColor } from '../../../design/tokens'
import { Chip, HelpTip, Panel } from '../../../ui'
import { fmtValue } from '../format'
import { ActionChip } from './chips'
import { KellyExplainer } from './glossary'

function Metric({ k, v, help, className }: { k: string; v: string; help?: string; className?: string }) {
  return (
    <div>
      <div className="label">{help ? <HelpTip term={k}>{help}</HelpTip> : k}</div>
      <div className={clsx('num mt-0.5 text-sm text-foreground', className)}>{v}</div>
    </div>
  )
}

/**
 * The trade plan for the structure as ONE net order: legs with real contracts,
 * entry/target/stop, expected and at-risk dollars, R:R, capacity and a
 * half-Kelly sizing illustration. An estimate from the engine's own numbers.
 */
export function TradeTicket({ d, mode }: { d: InstrumentDetail; mode: QuantMode }) {
  const p = d.plan
  const v = d.verdicts[mode]
  const acting = v.action !== 'AVOID'
  const u = p.unit
  return (
    <Panel
      density="dense"
      title="Trade ticket"
      eyebrow={acting ? 'Actionable in this mode' : 'If taken (the verdict says stand aside)'}
      actions={<ActionChip verdict={v} />}
      provenance={{ source: 'Engine trade plan (tradePlan.ts); OOS figures from the walk-forward', asOf: d.asOf, modeled: true, note: 'Estimate, not a guarantee' }}
    >
      {p.side === 0 ? (
        <p className="text-sm text-muted">No directional edge — the structure sits at its mean.</p>
      ) : (
        <>
          <ul className="mb-3 flex flex-wrap gap-1.5" aria-label="Legs">
            {p.legs.map((l) => (
              <li key={l.leg}>
                <Chip tone={l.side === 'long' ? 'strong' : 'avoid'}>
                  {l.side === 'long' ? 'buy' : 'sell'} {l.qty !== 1 ? `${l.qty}× ` : ''}
                  {l.contract ?? l.leg}
                </Chip>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Metric k="Entry" v={fmtValue(p.entry, u)} help="The structure's current net value — quote it as one net combo order." />
            <Metric k="Target" v={fmtValue(p.target, u)} help="The reversion target: the rolling mean (spreads, flies, ratio) or the seasonal-average move (seasonal pairs)." />
            <Metric k="Stop" v={fmtValue(p.stop, u)} help="Where the realistic loss is hit: the out-of-sample max drawdown when available, else 2σ adverse." />
            <Metric k="Entry zone" v={p.entryZone ? `${fmtValue(p.entryZone[0], u)} – ${fmtValue(p.entryZone[1], u)}` : '—'} help="Entry ± 0.5σ: the band where the edge still holds." />
            <Metric k="Expected $" v={fmtUsd(p.expectedUsd, 0)} className={signColor(p.expectedUsd)} help={`(target − entry) × $${fmtNum(p.pointValue, 2)} per point, per structure.`} />
            <Metric k="Risk $" v={fmtUsd(p.riskUsd, 0)} className="text-neg-text" />
            <Metric k="Reward : risk" v={p.rewardRisk != null ? `${fmtNum(p.rewardRisk, 2)}×` : '—'} />
            <Metric k="OOS win rate" v={fmtPct(d.oos.trades ? d.oos.winRate : null, 0)} />
            <Metric k="Liquidity" v={p.capacity.tier} help={p.capacity.note} />
            <Metric k="Median volume" v={p.capacity.medianAdv ? `${fmtNum(p.capacity.medianAdv, 0)}/d` : '—'} help="Median daily volume summed across legs; the spread's own book is thinner." />
            <Metric k="Suggested max" v={p.capacity.suggestedMaxContracts ? `${fmtNum(p.capacity.suggestedMaxContracts, 0)} sets` : '—'} help="0.5% of median daily volume — a participation cap, not a guarantee." />
            <Metric k="Half-Kelly" v={p.kelly ? fmtPct(p.kelly.halfKelly, 1) : '—'} help={p.kelly?.note ?? 'Needs ≥ 5 out-of-sample trades with both wins and losses.'} />
          </div>
          <p className="mt-3 border-t border-border pt-2 text-2xs text-muted">{p.note}</p>
          {p.kelly && (
            <div className="mt-2">
              <KellyExplainer />
            </div>
          )}
        </>
      )}
    </Panel>
  )
}
