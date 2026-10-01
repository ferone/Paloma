import { Link } from 'react-router-dom'
import { isQuantEmpty, type QuantOpportunity } from '@shared/quant'
import { UNIVERSE, type AssetId } from '@shared/universe'
import { fmtNum, fmtPct } from '../../../design/format'
import { Chip, Panel } from '../../../ui'
import { useSeasonality } from '../api'

/**
 * Seasonal windows of the selected asset whose walk-forward out-of-sample test
 * PASSED. Leads to research, not signals: each window trades once a year, so
 * even a dozen years is a small sample. Generic over assets: it reads the
 * opportunities already on the page and the existing seasonality endpoint.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function seasonalLeads(rows: QuantOpportunity[], asset: AssetId): QuantOpportunity[] {
  return rows
    .filter((o) => o.kind === 'seasonal' && o.oos === 'passed' && o.metal === asset && o.window)
    .sort((a, b) => b.qtRank - a.qtRank)
}

function LeadCard({ lead }: { lead: QuantOpportunity }) {
  const q = useSeasonality(lead.id)
  const detail = q.data && !isQuantEmpty(q.data) ? q.data : null
  const w = lead.window!
  const live = detail?.windows.some((x) => x.active && x.entryLabel === w.entryLabel && x.exitLabel === w.exitLabel) ?? false
  const oos = detail?.oos ?? null
  return (
    <li>
      <Link
        to={`/quant/i/${encodeURIComponent(lead.id)}`}
        className="block h-full rounded-md border border-border bg-surface-2 px-3 py-2 transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-foreground">{lead.label}</span>
          {live && <Chip tone="moderate">in window</Chip>}
        </div>
        <div className="num mt-1 text-xs text-muted">
          {w.side === 'long' ? 'Long' : 'Short'} {w.entryLabel} → {w.exitLabel} · in-sample win {fmtPct(w.winRate, 0)}
        </div>
        <div className="num mt-0.5 text-2xs text-faint">
          {oos ? `OOS ${oos.trades} trades · Sharpe ${fmtNum(oos.sharpe, 2)}` : 'OOS passed'}
          {lead.survivesRegime === false ? ' · regime-fragile' : ''}
        </div>
      </Link>
    </li>
  )
}

export function SeasonalLeads({ rows, asset }: { rows: QuantOpportunity[]; asset: AssetId }) {
  const leads = seasonalLeads(rows, asset)
  const label = UNIVERSE[asset].label
  if (!leads.length) {
    return (
      <p className="text-2xs text-muted">
        Leads: no {label.toLowerCase()} seasonal window has passed the walk-forward out-of-sample test.
      </p>
    )
  }
  return (
    <Panel density="dense" eyebrow={`${label} · seasonal`} title="Leads">
      <p className="mb-3 text-2xs text-muted">
        Seasonal spread windows that passed walk-forward out-of-sample testing. Paper-trade first: each window trades once a year, so
        the evidence rests on a small sample of yearly outcomes.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label={`${label} seasonal leads`}>
        {leads.map((l) => (
          <LeadCard key={l.id} lead={l} />
        ))}
      </ul>
    </Panel>
  )
}
