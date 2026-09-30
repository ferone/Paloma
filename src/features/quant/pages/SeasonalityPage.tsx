import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { InstrumentListItem, QuantOpportunity, SeasonalityDetail } from '@shared/quant'
import { isQuantEmpty } from '@shared/quant'
import { UNIVERSE } from '@shared/universe'
import { ASSET_COLOR } from '../../../design/tokens'
import { fmtPct } from '../../../design/format'
import { PerYearOverlay, SeasonalPattern, SeasonalReturnsHeatmap, WindowStatsTable } from '../../../charts'
import { DataTable, Field, Panel, Select, type Column } from '../../../ui'
import { useInstruments, useOpportunities, useSeasonality } from '../api'
import { NoFuturesState, QuantQuery } from '../components/QuantQuery'
import { ActionChip, OosChip } from '../components/chips'
import { SeasonalExplainer } from '../components/glossary'
import { OosPanel } from '../components/InstrumentPanels'
import { KIND_LABEL, valueFormatter } from '../format'
import { useQuantContext } from '../QuantLayout'
import { pairsForAsset } from '../pairs'

export default function SeasonalityPage() {
  const { asset } = useQuantContext()
  const list = useInstruments(asset)
  const front = UNIVERSE[asset].futures[0]
  if (!front) return <NoFuturesState label={UNIVERSE[asset].label} what="seasonal envelopes and roll-clean pair spreads" />
  return <QuantQuery q={list}>{(items) => <Seasonality key={asset} items={items} root={front.root} />}</QuantQuery>
}

const EDGE_COLUMNS: Column<QuantOpportunity>[] = [
  { key: 'label', header: 'Pair spread', cell: (o) => <span className="text-foreground">{o.label}</span>, sortValue: (o) => o.label },
  { key: 'oos', header: 'OOS', cell: (o) => <OosChip status={o.oos} fragile={o.survivesRegime === false} />, sortValue: (o) => ['untested', 'failed', 'passed'].indexOf(o.oos) },
  {
    key: 'win',
    header: 'Best window (prior seasons)',
    cell: (o) => (o.window ? <span className="num text-2xs">{`${o.window.side} ${o.window.entryLabel} → ${o.window.exitLabel} · ${fmtPct(o.window.winRate, 0)}`}</span> : <span className="text-2xs text-faint">none cleared the bar</span>),
  },
  { key: 'verdict', header: 'Verdict', cell: (o) => <ActionChip verdict={o.verdict} /> },
  { key: 'rank', header: 'Rank', numeric: true, cell: (o) => o.qtRank.toFixed(1), sortValue: (o) => o.qtRank },
]

function Seasonality({ items, root }: { items: InstrumentListItem[]; root: string }) {
  const { asset, mode } = useQuantContext()
  const [params, setParams] = useSearchParams()
  // The asset's own structures plus the ratio of every relative-value pair it takes part in.
  const ratios = new Set(pairsForAsset(asset).map((p) => `${p.pair.id}.ratio`))
  const choices = items.filter((i) => i.id.startsWith(`${root}.`) || ratios.has(i.id))
  const id = params.get('id') && choices.some((c) => c.id === params.get('id')) ? params.get('id')! : `${root}.out`
  const setId = (v: string) => setParams({ id: v }, { replace: true })
  const q = useSeasonality(id)
  const opps = useOpportunities(asset, mode)
  const edges = useMemo(() => (opps.data && !isQuantEmpty(opps.data) ? opps.data.rows.filter((o) => o.kind === 'seasonal' && o.metal === asset) : []), [opps.data, asset])

  const groups = [
    { label: 'Continuous', items: choices.filter((c) => c.kind !== 'seasonal') },
    { label: 'Roll-clean pair spreads', items: choices.filter((c) => c.kind === 'seasonal') },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Instrument" className="w-full max-w-sm">
          <Select value={id} onChange={(e) => setId(e.target.value)}>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({KIND_LABEL[c.kind]})
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Link to={`/quant/i/${encodeURIComponent(id)}`} className="text-xs text-brand underline underline-offset-2">
          Verdict & trade ticket →
        </Link>
      </div>
      <QuantQuery q={q} rows={10}>
        {(s) => <SeasonalityView key={s.id} s={s} />}
      </QuantQuery>
      <Panel density="dense" title="Seasonal pair edges" eyebrow={`${UNIVERSE[asset].label} · every seasonal-month pair · ${mode}`} provenance={{ source: 'Databento GLBX.MDP3 · roll-clean contract pairs', asOf: opps.data && !isQuantEmpty(opps.data) ? opps.data.dataThrough : null, note: `${edges.length} pairs scanned — some pass by chance; prefer regime-robust passes` }}>
        <DataTable dense caption="Seasonal pair spreads with OOS status" columns={EDGE_COLUMNS} rows={edges} rowKey={(o) => o.id} initialSort={{ key: 'rank', dir: 'desc' }} onRowClick={(o) => setId(o.id)} empty="No pair spread has ≥ 6 seasons of history yet." />
      </Panel>
    </div>
  )
}

function SeasonalityView({ s }: { s: SeasonalityDetail }) {
  const [showWindows, setShowWindows] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)
  const fmt = valueFormatter(s.unit)
  const color = ASSET_COLOR[s.metal]
  const wins = selected !== null ? [s.windows[selected]] : s.windows.slice(0, 3)
  const unitNote = s.rebase === 'rebasePct' ? '% change from each season’s start' : `${s.unit}, absolute`
  const provenance = { ...s.provenance }
  return (
    <div className="space-y-4">
      <Panel
        density="dense"
        title="Seasonal envelope"
        eyebrow={`${s.label} · ${unitNote}${s.originDoy > 1 ? ' · season-day axis' : ''}`}
        actions={
          <label className="flex items-center gap-1.5 text-2xs text-muted">
            <input type="checkbox" checked={showWindows} onChange={(e) => setShowWindows(e.target.checked)} className="accent-[var(--brand)]" />
            Shade {selected !== null ? 'selected' : 'top'} windows
          </label>
        }
        provenance={provenance}
      >
        <SeasonalPattern
          envelope={s.envelope}
          current={s.current}
          monthTicks={s.monthTicks}
          originDoy={s.originDoy}
          yFormat={fmt}
          color={color}
          windows={showWindows ? wins.map((w) => ({ entryDoy: w.entryDoy, exitDoy: w.exitDoy, side: w.side })) : []}
        />
        <div className="mt-2">
          <SeasonalExplainer />
        </div>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel density="dense" title="Every season overlaid" eyebrow={`${s.perYear.length + (s.current ? 1 : 0)} seasons · hover to pick one out`} provenance={provenance}>
          <PerYearOverlay years={s.perYear} current={s.current} monthTicks={s.monthTicks} originDoy={s.originDoy} yFormat={fmt} color={color} />
        </Panel>
        <Panel density="dense" title="Seasonal windows" eyebrow="Found on prior seasons only · click to shade" provenance={{ ...provenance, note: 'In-sample candidates — the OOS test below decides' }}>
          <WindowStatsTable windows={s.windows} selected={selected} onSelect={(i) => setSelected((cur) => (cur === i ? null : i))} />
        </Panel>
      </div>
      <Panel density="dense" title="Monthly returns" eyebrow={s.monthly.basis === 'pct' ? 'Month-end vs prior month-end, %' : `Month-end change, ${s.unit}`} provenance={provenance}>
        <SeasonalReturnsHeatmap cells={s.monthly.cells} years={s.monthly.years} summary={s.monthly.summary} basis={s.monthly.basis} unit={s.unit} />
      </Panel>
      <OosPanel oos={s.oos} asOf={s.asOf} />
    </div>
  )
}
