import { Link, useParams } from 'react-router-dom'
import type { InstrumentDetail } from '@shared/quant'
import { RELATIVE_VALUE_PAIRS, UNIVERSE } from '@shared/universe'
import { fmtPct, fmtUsd } from '../../../design/format'
import { Chip, Panel } from '../../../ui'
import { useInstrument } from '../api'
import { QuantQuery } from '../components/QuantQuery'
import { ActionChip, OosChip } from '../components/chips'
import { BasisExplainer, BasisStats, BasisTicket, BasisVsBillPanel, ExcessCarryBandsPanel } from '../components/BasisPanels'
import { CurvaturePanel, OosPanel, SignalStats, StructuralPanel, ZBandPanel } from '../components/InstrumentPanels'
import { TradeTicket } from '../components/TradeTicket'
import { WhyVerdict } from '../components/WhyVerdict'
import { KIND_LABEL, fmtValue } from '../format'
import { useQuantContext } from '../QuantLayout'

export default function InstrumentPage() {
  const { id } = useParams()
  const q = useInstrument(id)
  return (
    <QuantQuery q={q} rows={10}>
      {(d) => <Instrument d={d} />}
    </QuantQuery>
  )
}

function Instrument({ d }: { d: InstrumentDetail }) {
  const { mode } = useQuantContext()
  const last = d.series[d.series.length - 1]
  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="text-2xs text-muted">
        <Link to="/quant" className="hover:text-foreground">
          Scanner
        </Link>{' '}
        / <span className="num">{d.id}</span>
      </nav>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">
            {KIND_LABEL[d.kind]} · {RELATIVE_VALUE_PAIRS.find((p) => p.id === d.product)?.label ?? UNIVERSE[d.metal]?.label ?? d.metal}
          </div>
          <h2 className="display mt-1 text-2xl text-foreground">{d.label}</h2>
          {d.kind === 'basis' ? (
            <p className="num mt-1 text-xs text-muted">
              excess carry {last ? `${fmtValue(last.value, d.unit)} p.a.` : '—'} · {fmtUsd(d.pointValue, 2)} per bp per contract · data through {d.dataThrough ?? '—'}
            </p>
          ) : (
            <p className="num mt-1 text-xs text-muted">
              {last ? `${fmtValue(last.value, d.unit)} ${d.unit === 'ratio' ? '' : d.unit}` : '—'}
              {d.kind !== 'ratio' ? ` · ${fmtUsd(d.pointValue, 0)} per point` : ''} · data through {d.dataThrough ?? '—'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionChip verdict={d.verdicts[mode]} />
          <OosChip status={d.oos.status} fragile={d.oos.regime ? !d.oos.regime.survives && d.oos.status === 'passed' : null} />
          {d.ml && (
            <Chip tone={d.ml.counted ? 'brand' : 'neutral'} title={d.ml.counted ? 'Validated: moves the rank' : 'Not validated: shown only'}>
              ML {d.ml.pConverge != null ? `p ${fmtPct(d.ml.pConverge, 0)}` : d.ml.pUp != null ? `p↑ ${fmtPct(d.ml.pUp, 0)}` : ''} · {d.ml.validationStatus}
            </Chip>
          )}
          {(d.kind === 'seasonal' || d.kind === 'outright' || d.kind === 'calendar') && (
            <Link to={`/quant/seasonality?id=${encodeURIComponent(d.id)}`} className="text-xs text-brand underline underline-offset-2">
              Seasonality →
            </Link>
          )}
          {(d.kind === 'ratio' || d.kind === 'inter' || d.kind === 'basis') && (
            <Link to="/quant/relative-value" className="text-xs text-brand underline underline-offset-2">
              Relative value →
            </Link>
          )}
        </div>
      </header>

      {d.kind === 'basis' && d.basis ? (
        <>
          <div className="rounded-lg border border-border bg-surface p-4">
            <BasisStats d={d} />
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <BasisVsBillPanel d={d} />
              <ExcessCarryBandsPanel d={d} />
              <SignalStats d={d} />
            </div>
            <div className="space-y-4">
              <WhyVerdict d={d} mode={mode} />
              <BasisTicket d={d} mode={mode} />
              <BasisExplainer settlement={d.basis.settlement} />
            </div>
          </div>
        </>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <ZBandPanel d={d} />
            {d.kind !== 'seasonal' && <SignalStats d={d} />}
            <CurvaturePanel d={d} />
            <StructuralPanel d={d} />
          </div>
          <div className="space-y-4">
            <WhyVerdict d={d} mode={mode} />
            <TradeTicket d={d} mode={mode} />
          </div>
        </div>
      )}

      <OosPanel oos={d.oos} asOf={d.asOf} unit={d.kind === 'basis' ? 'bp' : 'usd'} />

      {d.window && (
        <Panel density="dense" title="Seasonal window in play" eyebrow="Found on prior seasons only" provenance={{ source: 'Engine (findWindows.ts)', asOf: d.asOf }}>
          <p className="text-sm text-foreground">
            {d.window.side === 'long' ? 'Long' : 'Short'} from {d.window.entryLabel} to {d.window.exitLabel}: won {fmtPct(d.window.winRate, 0)} of {d.window.years} seasons, average{' '}
            {fmtUsd(d.window.avgPnl, 0)}, t = {d.window.tStat.toFixed(2)}.{d.window.active ? ' Today is inside it.' : ''}
          </p>
        </Panel>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel density="dense" title="Evidence" eyebrow="How the QT rank was built">
          <ul className="list-disc space-y-1 pl-4 text-xs text-foreground/85">
            {d.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Panel>
        <Panel density="dense" title="Caveats">
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
            {d.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
