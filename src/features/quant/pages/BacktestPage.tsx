import { Link } from 'react-router-dom'
import { isQuantEmpty, type BacktestDecisionRow, type BacktestInstrumentRow, type BacktestView, type GateAblationRow } from '@shared/quant'
import { UNIVERSE } from '@shared/universe'
import { signColor } from '../../../design/tokens'
import { fmtDate, fmtPct, fmtSigned, fmtUsd } from '../../../design/format'
import { EquityCurve, OutcomeHistogram } from '../../../charts'
import { Chip, DataTable, Panel, Stat, type Column } from '../../../ui'
import { useBacktest, useGates } from '../api'
import { QuantEmptyState, QuantQuery } from '../components/QuantQuery'
import { BacktestExplainer } from '../components/glossary'
import { useQuantContext } from '../QuantLayout'

export default function BacktestPage() {
  const { metal, mode } = useQuantContext()
  const q = useBacktest(metal, mode)
  return <QuantQuery q={q} rows={10}>{(b) => <Backtest b={b} />}</QuantQuery>
}

const INST_COLS: Column<BacktestInstrumentRow>[] = [
  { key: 'l', header: 'Instrument', cell: (r) => <Link className="hover:text-brand" to={`/quant/i/${encodeURIComponent(r.instrumentId)}`}>{r.label}</Link>, sortValue: (r) => r.label },
  { key: 'd', header: 'Decisions', numeric: true, cell: (r) => r.decisions, sortValue: (r) => r.decisions },
  { key: 'b', header: 'Trades', numeric: true, cell: (r) => r.buys, sortValue: (r) => r.buys },
  { key: 'm', header: 'Model $', numeric: true, cell: (r) => <span className={signColor(r.modelPnl)}>{fmtUsd(r.modelPnl, 0)}</span>, sortValue: (r) => r.modelPnl },
  { key: 'ma', header: '$/trade', numeric: true, cell: (r) => fmtUsd(r.modelAvg, 0), sortValue: (r) => r.modelAvg },
  { key: 'w', header: 'Win', numeric: true, cell: (r) => (r.buys ? fmtPct(r.modelWinRate, 0) : '—'), sortValue: (r) => r.modelWinRate },
  { key: 'p', header: 'Baseline $', numeric: true, cell: (r) => <span className={signColor(r.passivePnl)}>{fmtUsd(r.passivePnl, 0)}</span>, sortValue: (r) => r.passivePnl },
]

const DEC_COLS: Column<BacktestDecisionRow>[] = [
  { key: 'date', header: 'Date', cell: (d) => <span className="num">{fmtDate(d.date)}</span>, sortValue: (d) => d.date },
  { key: 'i', header: 'Instrument', cell: (d) => <span className="num text-2xs">{d.instrumentId}</span>, sortValue: (d) => d.instrumentId },
  { key: 'z', header: 'z', numeric: true, cell: (d) => fmtSigned(d.z, 2), sortValue: (d) => Math.abs(d.z) },
  { key: 'v', header: 'Verdict', cell: (d) => (d.verdict === 'BUY' ? <Chip tone={d.direction > 0 ? 'strong' : 'avoid'}>{d.direction > 0 ? 'long' : 'short'}</Chip> : <Chip tone="neutral">stand aside</Chip>) },
  { key: 'o', header: 'OOS at t', cell: (d) => <span className="text-2xs text-muted">{d.validationStatus}</span> },
  { key: 'm', header: 'Model $', numeric: true, cell: (d) => <span className={signColor(d.modelPnl)}>{d.verdict === 'BUY' ? fmtUsd(d.modelPnl, 0) : '—'}</span>, sortValue: (d) => d.modelPnl },
  { key: 'p', header: 'If faded $', numeric: true, cell: (d) => <span className={signColor(d.passivePnl)}>{fmtUsd(d.passivePnl, 0)}</span>, sortValue: (d) => d.passivePnl },
]

const GATE_COLS: Column<GateAblationRow>[] = [
  { key: 'g', header: 'Gate', cell: (g) => g.label },
  { key: 'k', header: 'Kept', numeric: true, cell: (g) => `${g.keptTrades} · ${fmtUsd(g.keptAvg, 0)}` },
  { key: 'r', header: 'Removed', numeric: true, cell: (g) => `${g.removedTrades} · ${fmtUsd(g.removedAvg, 0)}` },
  { key: 'a', header: 'All $/trade', numeric: true, cell: (g) => fmtUsd(g.allAvg, 0) },
  { key: 'u', header: 'Uplift $/trade', numeric: true, cell: (g) => <span className={signColor(g.upliftPerTrade)}>{fmtUsd(g.upliftPerTrade, 0)}</span> },
  { key: 'x', header: 'Ex-shock uplift', numeric: true, cell: (g) => <span className={signColor(g.exShockUplift)}>{fmtUsd(g.exShockUplift, 0)}</span> },
  { key: 'v', header: 'Verdict', cell: (g) => <Chip tone={g.verdict === 'helps' ? 'strong' : g.verdict === 'hurts' ? 'avoid' : 'neutral'}>{g.verdict}</Chip> },
]

function Backtest({ b }: { b: BacktestView }) {
  const t = b.totals
  const gates = useGates(b.metal)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat size="md" label="Model P&L" value={<span className={signColor(t.modelPnl)}>{fmtUsd(t.modelPnl, 0)}</span>} hint={`${t.verdict} · ${b.mode}`} />
        <Stat size="md" label="Trades taken" value={`${t.buys} / ${t.decisions}`} hint="verdict trades / decisions" />
        <Stat size="md" label="$ per trade" value={fmtUsd(t.modelAvg, 0)} hint={`baseline ${fmtUsd(t.passiveAvg, 0)}`} />
        <Stat size="md" label="Win rate" value={fmtPct(t.modelWinRate, 0)} hint={`baseline ${fmtPct(t.passiveWinRate, 0)}`} />
        <Stat size="md" label="Max drawdown" value={fmtUsd(t.maxDrawdown, 0)} />
        <Stat size="md" label="Baseline P&L" value={<span className={signColor(t.passivePnl)}>{fmtUsd(t.passivePnl, 0)}</span>} hint="fade every stretch" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel density="dense" title="Equity curve" eyebrow={`${UNIVERSE[b.metal].label} + gold/silver · ${fmtDate(b.start)} → ${fmtDate(b.end)} · $${b.dollarsAtRisk} per 1σ, $${b.costPerTrade} cost`} provenance={{ ...b.provenance, modeled: true }}>
          {b.equity.length > 1 ? <EquityCurve points={b.equity} /> : <p className="py-8 text-center text-xs text-muted">Not enough decisions to plot.</p>}
        </Panel>
        <div className="space-y-4">
          <Panel density="dense" title="Outcome distribution" eyebrow={t.buys ? 'Per verdict trade, $' : 'Per decision if faded, $ (no verdict trades)'} provenance={{ ...b.provenance, modeled: true }}>
            <OutcomeHistogram bins={b.histogram} />
          </Panel>
          <BacktestExplainer />
        </div>
      </div>

      <Panel density="dense" title="QT gate ablation" eyebrow="Does each selection gate earn its place, out of sample?" provenance={gates.data && !isQuantEmpty(gates.data) ? gates.data.provenance : undefined}>
        {gates.isPending ? null : gates.data && isQuantEmpty(gates.data) ? (
          <QuantEmptyState empty={gates.data} compact />
        ) : gates.data ? (
          <>
            <DataTable dense caption="Gate ablation" columns={GATE_COLS} rows={gates.data.rows} rowKey={(g) => g.gate} />
            <p className="mt-2 text-2xs text-muted">{gates.data.note}</p>
          </>
        ) : null}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel density="dense" title="By instrument" provenance={{ ...b.provenance, modeled: true }}>
          <DataTable dense caption="Backtest by instrument" columns={INST_COLS} rows={b.byInstrument} rowKey={(r) => r.instrumentId} initialSort={{ key: 'm', dir: 'desc' }} />
        </Panel>
        <Panel density="dense" title="Decision ledger" eyebrow="Most recent 60 point-in-time decisions" provenance={{ ...b.provenance, modeled: true }}>
          <DataTable dense caption="Backtest decisions" columns={DEC_COLS} rows={b.decisions.slice(-60)} rowKey={(d) => `${d.date}-${d.instrumentId}`} initialSort={{ key: 'date', dir: 'desc' }} />
        </Panel>
      </div>
    </div>
  )
}
