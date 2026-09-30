import { useMemo } from 'react'
import type { CurvePointView, CurveView } from '@shared/quant'
import { ASSETS, UNIVERSE, futuresProduct } from '@shared/universe'
import { ASSET_COLOR, PALETTE } from '../../../design/tokens'
import { fmtCompact, fmtDate, fmtNum, fmtPctSigned } from '../../../design/format'
import { ForwardCurveChart, type CurveSeries } from '../../../charts'
import { Chip, DataTable, Panel, type Column } from '../../../ui'
import { useCurve } from '../api'
import { QuantQuery } from '../components/QuantQuery'
import { ContangoExplainer } from '../components/glossary'
import { useQuantContext } from '../QuantLayout'

/** Term structure of every asset with listed futures, the asset in focus first. */
export default function CurvePage() {
  const { asset } = useQuantContext()
  const order = [asset, ...ASSETS.filter((a) => a !== asset)].filter((a) => UNIVERSE[a].futures.length > 0)
  return (
    <div className="space-y-4">
      {order.map((m) => (
        <CurveBlock key={m} root={UNIVERSE[m].futures[0].root} />
      ))}
      <ContangoExplainer />
    </div>
  )
}

/** Curve table columns; settles use the asset's price decimals. */
const columnsFor = (decimals: number): Column<CurvePointView>[] => [
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
  { key: 'px', header: 'Settle', numeric: true, cell: (p) => fmtNum(p.price, decimals) },
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
    if (c.points.length) out.push({ key: 'latest', label: `settle ${fmtDate(c.asOf)}`, color: ASSET_COLOR[c.metal], nodes: c.points.filter((p) => p.days !== null).map((p) => ({ days: p.days!, label: p.label, price: p.price, active: p.active })) })
    if (c.prior) out.push({ key: 'prior', label: `a month earlier (${fmtDate(c.prior.asOf)})`, color: PALETTE.muted, dash: true, nodes: c.prior.points.filter((p) => p.days !== null).map((p) => ({ days: p.days!, label: p.label, price: p.price })) })
    if (c.live) out.push({ key: 'live', label: `Yahoo live (${fmtDate(c.live.asOf)})`, color: PALETTE.series[1], nodes: c.live.points.filter((p) => p.days !== null).map((p) => ({ days: p.days!, label: p.label, price: p.price, active: p.active })) })
    return out
  }, [c])
  const tone = c.regime === 'contango' ? 'strong' : c.regime === 'backwardation' ? 'avoid' : 'neutral'
  const product = futuresProduct(c.root)
  const name = product?.name ?? c.root
  const decimals = UNIVERSE[c.metal].displayDecimals
  const columns = useMemo(() => columnsFor(decimals), [decimals])
  return (
    <Panel
      density="dense"
      title={`${name} term structure`}
      eyebrow={`${c.root} · active months ${product?.activeMonths.length ?? '—'} per year`}
      actions={
        <div className="flex items-center gap-2">
          <Chip tone={tone}>{c.regime}</Chip>
          <span className="num text-2xs text-muted">front carry {fmtPctSigned(c.frontCarry, 2)}/yr</span>
        </div>
      }
      provenance={{ ...c.provenance, note: [c.provenance.note, c.liveNote].filter(Boolean).join(' · ') || undefined }}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <ForwardCurveChart curves={curves} yFormat={(v) => fmtNum(v, decimals)} />
        <DataTable dense caption={`${c.root} contracts on the curve`} columns={columns} rows={c.points} rowKey={(p) => `${p.source}-${p.symbol}`} />
      </div>
    </Panel>
  )
}
