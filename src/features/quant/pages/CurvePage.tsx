import { useMemo } from 'react'
import type { CurvePointView, CurveView } from '@shared/quant'
import { METALS, UNIVERSE } from '@shared/universe'
import { METAL_COLOR, PALETTE } from '../../../design/tokens'
import { fmtCompact, fmtDate, fmtNum, fmtPctSigned } from '../../../design/format'
import { ForwardCurveChart, type CurveSeries } from '../../../charts'
import { Chip, DataTable, Panel, type Column } from '../../../ui'
import { useCurve } from '../api'
import { QuantQuery } from '../components/QuantQuery'
import { ContangoExplainer } from '../components/glossary'
import { useQuantContext } from '../QuantLayout'

/** Term structure for gold and silver side by side (metal in focus first). */
export default function CurvePage() {
  const { metal } = useQuantContext()
  const order = [metal, ...METALS.filter((m) => m !== metal)]
  return (
    <div className="space-y-4">
      {order.map((m) => (
        <CurveBlock key={m} root={UNIVERSE[m].futures[0].root} />
      ))}
      <ContangoExplainer />
    </div>
  )
}

const COLUMNS: Column<CurvePointView>[] = [
  {
    key: 'c',
    header: 'Contract',
    cell: (p) => (
      <span className={p.active ? 'text-foreground' : 'text-faint'}>
        <span className="num">{p.symbol}</span> <span className="text-2xs text-muted">{p.label}</span>
        {!p.active && <span className="ml-1 text-2xs">(serial)</span>}
      </span>
    ),
  },
  { key: 'lt', header: 'Last trade', cell: (p) => <span className="num text-2xs">{fmtDate(p.lastTrade)}</span> },
  { key: 'd', header: 'Days', numeric: true, cell: (p) => (p.days ?? '—').toString() },
  { key: 'px', header: 'Settle', numeric: true, cell: (p) => fmtNum(p.price, 2) },
  { key: 'carry', header: 'Ann. carry vs front', numeric: true, cell: (p) => fmtPctSigned(p.annualizedCarry, 2) },
  { key: 'v', header: 'Volume', numeric: true, cell: (p) => fmtCompact(p.volume) },
  { key: 'oi', header: 'Open int.', numeric: true, cell: (p) => fmtCompact(p.openInterest) },
]

function CurveBlock({ root }: { root: string }) {
  const q = useCurve(root)
  return <QuantQuery q={q} rows={6}>{(c) => <Curve c={c} />}</QuantQuery>
}

function Curve({ c }: { c: CurveView }) {
  const curves = useMemo(() => {
    const out: CurveSeries[] = []
    if (c.points.length) out.push({ key: 'latest', label: `settle ${fmtDate(c.asOf)}`, color: METAL_COLOR[c.metal], nodes: c.points.filter((p) => p.days !== null).map((p) => ({ days: p.days!, label: p.label, price: p.price, active: p.active })) })
    if (c.prior) out.push({ key: 'prior', label: `a month earlier (${fmtDate(c.prior.asOf)})`, color: PALETTE.muted, dash: true, nodes: c.prior.points.filter((p) => p.days !== null).map((p) => ({ days: p.days!, label: p.label, price: p.price })) })
    if (c.live) out.push({ key: 'live', label: `Yahoo live (${fmtDate(c.live.asOf)})`, color: PALETTE.series[1], nodes: c.live.points.filter((p) => p.days !== null).map((p) => ({ days: p.days!, label: p.label, price: p.price, active: p.active })) })
    return out
  }, [c])
  const tone = c.regime === 'contango' ? 'strong' : c.regime === 'backwardation' ? 'avoid' : 'neutral'
  const name = UNIVERSE[c.metal].futures[0].name
  return (
    <Panel
      density="dense"
      title={`${name} term structure`}
      eyebrow={`${c.root} · active months ${UNIVERSE[c.metal].futures[0].activeMonths.length} per year`}
      actions={
        <div className="flex items-center gap-2">
          <Chip tone={tone}>{c.regime}</Chip>
          <span className="num text-2xs text-muted">front carry {fmtPctSigned(c.frontCarry, 2)}/yr</span>
        </div>
      }
      provenance={{ ...c.provenance, note: [c.provenance.note, c.liveNote].filter(Boolean).join(' · ') || undefined }}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <ForwardCurveChart curves={curves} yFormat={(v) => fmtNum(v, c.metal === 'silver' ? 2 : 0)} />
        <DataTable dense caption={`${c.root} contracts on the curve`} columns={COLUMNS} rows={c.points} rowKey={(p) => `${p.source}-${p.symbol}`} />
      </div>
    </Panel>
  )
}
