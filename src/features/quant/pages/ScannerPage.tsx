import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { OpportunitiesResponse, QuantOpportunity } from '@shared/quant'
import { UNIVERSE } from '@shared/universe'
import { fmtNum, fmtPct, fmtSigned } from '../../../design/format'
import { signColor } from '../../../design/tokens'
import { DataTable, Panel, Segmented, Stat, type Column } from '../../../ui'
import { useOpportunities } from '../api'
import { QuantQuery } from '../components/QuantQuery'
import { ActionChip, CarryChip, OosChip, TierChip } from '../components/chips'
import { OuExplainer, VerdictExplainer, ZScoreExplainer } from '../components/glossary'
import { SeasonalLeads } from '../components/SeasonalLeads'
import { KIND_LABEL, fmtValue } from '../format'
import { useQuantContext } from '../QuantLayout'
import { pairNames } from '../pairs'
import { useAssistantContext } from '../../assistant/context'
import { scannerSummary } from '../../assistant/summaries'

type KindFilter = 'all' | 'spreads' | 'seasonal' | 'outright' | 'rv'

const FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'spreads', label: 'Spreads & flies' },
  { value: 'seasonal', label: 'Seasonal pairs' },
  { value: 'outright', label: 'Outrights' },
  { value: 'rv', label: 'Relative value' },
]

function matches(o: QuantOpportunity, f: KindFilter): boolean {
  if (f === 'all') return true
  if (f === 'spreads') return o.kind === 'calendar' || o.kind === 'butterfly'
  if (f === 'seasonal') return o.kind === 'seasonal'
  if (f === 'outright') return o.kind === 'outright'
  return o.kind === 'ratio' || o.kind === 'inter' || o.kind === 'basis'
}

const COLUMNS: Column<QuantOpportunity>[] = [
  {
    key: 'label',
    header: 'Instrument',
    cell: (o) => (
      <div className="min-w-44">
        <div className="text-foreground">{o.label}</div>
        <div className="num text-2xs text-muted">
          {KIND_LABEL[o.kind]} · {o.id} · {fmtValue(o.value, o.unit)}
        </div>
      </div>
    ),
    sortValue: (o) => o.label,
  },
  { key: 'tier', header: 'Tier', cell: (o) => <TierChip tier={o.tier} />, sortValue: (o) => ['AVOID', 'WATCH', 'MODERATE', 'STRONG'].indexOf(o.tier) },
  { key: 'verdict', header: 'Verdict', cell: (o) => <ActionChip verdict={o.verdict} long />, sortValue: (o) => (o.verdict.action === 'AVOID' ? 0 : 1), className: 'max-w-64' },
  { key: 'rank', header: 'QT rank', numeric: true, cell: (o) => fmtNum(o.qtRank, 1), sortValue: (o) => o.qtRank },
  { key: 'z', header: 'z', numeric: true, cell: (o) => <span className={signColor(o.z === null ? null : -o.z)}>{fmtSigned(o.z, 2)}</span>, sortValue: (o) => (o.z === null ? null : Math.abs(o.z)) },
  { key: 'zEff', header: 'Eff. z', numeric: true, cell: (o) => fmtSigned(o.zEff, 2), sortValue: (o) => (o.zEff === null ? null : Math.abs(o.zEff)) },
  { key: 'hl', header: 'Half-life', numeric: true, cell: (o) => (o.halfLife === null ? '—' : `${fmtNum(o.halfLife, 1)} d`), sortValue: (o) => o.halfLife },
  { key: 'carry', header: 'Carry', cell: (o) => <CarryChip alignment={o.carry} conflict={o.gates.carryConflict} /> },
  { key: 'oos', header: 'OOS', cell: (o) => <OosChip status={o.oos} fragile={o.survivesRegime === false} />, sortValue: (o) => ['untested', 'failed', 'passed'].indexOf(o.oos) },
  {
    key: 'ml',
    header: 'ML p',
    numeric: true,
    cell: (o) => (o.mlProb === null ? '—' : <span title={o.mlCounted ? 'Validated model: counted in the rank' : 'Model not validated: shown, not counted'} className={o.mlCounted ? '' : 'text-faint'}>{fmtPct(o.mlProb, 0)}</span>),
    sortValue: (o) => o.mlProb,
  },
  {
    key: 'window',
    header: 'Season window',
    cell: (o) =>
      o.window ? (
        <span className="num whitespace-nowrap text-2xs text-muted">
          {o.window.side} {o.window.entryLabel}→{o.window.exitLabel} · {fmtPct(o.window.winRate, 0)}
        </span>
      ) : (
        <span className="text-2xs text-faint">—</span>
      ),
  },
]

export default function ScannerPage() {
  const { asset, mode } = useQuantContext()
  const q = useOpportunities(asset, mode)
  return (
    <QuantQuery q={q} rows={10}>
      {(data) => <Scanner data={data} />}
    </QuantQuery>
  )
}

function Scanner({ data }: { data: OpportunitiesResponse }) {
  const navigate = useNavigate()
  useAssistantContext(() => scannerSummary(data), [data])
  const [filter, setFilter] = useState<KindFilter>('all')
  const [actionable, setActionable] = useState(false)
  const rows = useMemo(() => data.rows.filter((o) => matches(o, filter) && (!actionable || o.verdict.action !== 'AVOID')), [data, filter, actionable])
  const acts = data.rows.filter((o) => o.verdict.action !== 'AVOID')
  const label = UNIVERSE[data.metal].label

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-5">
        <Stat label="Instruments" value={data.rows.length} size="sm" hint={[label, ...pairNames(data.metal)].join(' + ')} />
        <Stat label="Buy · long" value={acts.filter((o) => o.verdict.action === 'BUY').length} size="sm" hint={`${data.mode} mode`} />
        <Stat label="Sell · short" value={acts.filter((o) => o.verdict.action === 'SELL').length} size="sm" hint={`${data.mode} mode`} />
        <Stat label="OOS passed" value={data.rows.filter((o) => o.oos === 'passed').length} size="sm" hint="walk-forward" />
        <Stat label="ML counted" value={data.rows.filter((o) => o.mlCounted).length} size="sm" hint="validated nudges only" />
      </div>

      <SeasonalLeads rows={data.rows} asset={data.metal} />

      <Panel
        density="dense"
        title="Ranked opportunities"
        eyebrow={`${label} · ${data.mode}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<KindFilter> ariaLabel="Instrument kind" value={filter} onChange={setFilter} options={FILTERS} />
            <label className="flex items-center gap-1.5 text-2xs text-muted">
              <input type="checkbox" checked={actionable} onChange={(e) => setActionable(e.target.checked)} className="accent-[var(--brand)]" />
              Actionable only
            </label>
          </div>
        }
        provenance={data.provenance}
      >
        <DataTable
          dense
          caption="Quant opportunities ranked by QT composite"
          columns={COLUMNS}
          rows={rows}
          rowKey={(o) => o.id}
          initialSort={{ key: 'rank', dir: 'desc' }}
          onRowClick={(o) => navigate(`/quant/i/${encodeURIComponent(o.id)}`)}
          empty={actionable ? `No ${data.mode} trade signals right now — the engine stands aside.` : 'No instruments in this filter.'}
        />
      </Panel>

      <div className="grid gap-3 md:grid-cols-3">
        <VerdictExplainer />
        <ZScoreExplainer />
        <OuExplainer />
      </div>
    </div>
  )
}
