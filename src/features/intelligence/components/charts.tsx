import type { ReactNode } from 'react'
import type { MlCalibrationBin, MlFold, MlImportance, MlOosSeries } from '@shared/ml'
import { PALETTE } from '../../../design/tokens'
import { fmtNum, fmtPct } from '../../../design/format'

// Hand-built SVG charts. Colours are CSS variables passed via `style`, so they
// follow the theme without re-resolving. Every chart has a text alternative.

const W = 640
const AXIS = { fontSize: 10, fill: PALETTE.muted } as const
const MONO = { ...AXIS, fontFamily: 'var(--font-mono, ui-monospace, monospace)' } as const

function Frame({ label, height, children }: { label: string; height: number; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} className="h-auto w-full overflow-visible">
      <title>{label}</title>
      {children}
    </svg>
  )
}

/** AUC per test year (bars) vs the fold's baseline (ticks: logistic, or the naive base rate when logistic was chosen), with 0.50 / 0.55 reference lines. */
export function AucByYear({ folds }: { folds: MlFold[] }) {
  const H = 220
  const pad = { l: 36, r: 8, t: 10, b: 24 }
  const vals = folds.flatMap((f) => [f.auc, f.baselineAuc]).filter((v): v is number => v != null)
  const lo = Math.min(0.3, Math.floor((Math.min(...vals) - 0.02) * 20) / 20)
  const hi = Math.max(0.7, Math.ceil((Math.max(...vals) + 0.02) * 20) / 20)
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b)
  const bw = (W - pad.l - pad.r) / Math.max(folds.length, 1)
  const ticks: number[] = []
  for (let v = Math.ceil(lo * 10) / 10; v <= hi + 1e-9; v += 0.1) ticks.push(Number(v.toFixed(2)))
  const label = `Out-of-sample AUC by test year: ${folds.map((f) => `${f.testYear} ${fmtNum(f.auc, 2)}`).join(', ')}`
  return (
    <Frame label={label} height={H}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} style={{ stroke: PALETTE.border }} strokeWidth={0.5} />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" style={MONO}>{t.toFixed(1)}</text>
        </g>
      ))}
      {folds.map((f, i) => {
        const x = pad.l + i * bw
        const base = y(0.5)
        const v = f.auc ?? 0.5
        const good = v >= 0.55
        return (
          <g key={f.testYear}>
            <rect
              x={x + bw * 0.18}
              width={bw * 0.64}
              y={Math.min(base, y(v))}
              height={Math.max(1, Math.abs(y(v) - base))}
              rx={1.5}
              style={{ fill: good ? PALETTE.pos : v < 0.5 ? PALETTE.neg : PALETTE.faint, opacity: 0.8 }}
            />
            {f.baselineAuc != null && (
              <line x1={x + bw * 0.1} x2={x + bw * 0.9} y1={y(f.baselineAuc)} y2={y(f.baselineAuc)} style={{ stroke: PALETTE.foreground }} strokeWidth={1.5} />
            )}
            {(folds.length <= 12 || i % 2 === 0) && (
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" style={MONO}>{`’${String(f.testYear).slice(2)}`}</text>
            )}
          </g>
        )
      })}
      <line x1={pad.l} x2={W - pad.r} y1={y(0.5)} y2={y(0.5)} style={{ stroke: PALETTE.muted }} strokeWidth={1} />
      <line x1={pad.l} x2={W - pad.r} y1={y(0.55)} y2={y(0.55)} style={{ stroke: PALETTE.brand }} strokeWidth={1} strokeDasharray="4 3" />
      <text x={W - pad.r} y={y(0.55) - 4} textAnchor="end" style={{ ...AXIS, fill: PALETTE.brand }}>gate 0.55</text>
      <text x={W - pad.r} y={y(0.5) + 12} textAnchor="end" style={AXIS}>coin flip 0.50</text>
    </Frame>
  )
}

/** Trailing mean over `n` points (shorter at the start). */
function trailingMean(xs: number[], n: number): number[] {
  const out: number[] = []
  let sum = 0
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i]
    if (i >= n) sum -= xs[i - n]
    out.push(sum / Math.min(i + 1, n))
  }
  return out
}

/** Smoothing window (test days) of the OOS history lines: about a quarter. */
export const OOS_SMOOTH = 63

/**
 * The walk-forward out-of-sample record over the whole span: daily P(up) (faint
 * band: the range within each pixel column), its quarterly mean (line) against
 * the realized quarterly up-share (dashed), and a strip of what actually happened
 * (green = mostly up, red = mostly down, stronger = more one-sided). The x axis
 * is test days; test years are marked.
 */
export function OosHistory({ oos }: { oos: MlOosSeries }) {
  const H = 260
  const strip = 14
  const pad = { l: 36, r: 8, t: 10, b: 22 + strip + 6 }
  const n = oos.p.length
  const plotW = W - pad.l - pad.r
  const y = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b)
  const smooth = Math.max(1, Math.round(OOS_SMOOTH / Math.max(1, oos.step)))
  const pMean = trailingMean(oos.p, smooth)
  const yMean = trailingMean(oos.y, smooth)
  const cols = Math.max(1, Math.min(n, Math.floor(plotW / 2)))
  const per = n / cols
  const buckets = Array.from({ length: cols }, (_, c) => {
    const a = Math.floor(c * per)
    const b = Math.max(a + 1, Math.floor((c + 1) * per))
    let lo = 1
    let hi = 0
    let up = 0
    for (let i = a; i < b && i < n; i++) {
      lo = Math.min(lo, oos.p[i])
      hi = Math.max(hi, oos.p[i])
      up += oos.y[i]
    }
    const last = Math.min(n - 1, b - 1)
    return { x: pad.l + ((c + 0.5) / cols) * plotW, lo, hi, share: up / Math.max(1, Math.min(b, n) - a), pm: pMean[last], ym: yMean[last] }
  })
  const bw = plotW / cols
  const years: { year: number; i: number }[] = []
  oos.testYear.forEach((ty, i) => {
    if (i === 0 || ty !== oos.testYear[i - 1]) years.push({ year: ty, i })
  })
  const xi = (i: number) => pad.l + (i / Math.max(1, n)) * plotW
  const everyYear = years.length <= 14
  const upShare = n ? oos.y.reduce<number>((a, b) => a + b, 0) / n : 0
  const meanP = n ? oos.p.reduce((a, b) => a + b, 0) / n : 0
  const label =
    `Out-of-sample P(up) for ${n} test days, ${oos.date[0] ?? ''} to ${oos.date.at(-1) ?? ''}` +
    `${oos.step > 1 ? ` (every ${oos.step}th day)` : ''}: mean P(up) ${fmtPct(meanP, 1)}, realized up share ${fmtPct(upShare, 1)}.`
  const line = (key: 'pm' | 'ym') => buckets.map((b) => `${b.x.toFixed(1)},${y(b[key]).toFixed(1)}`).join(' ')
  const yStrip = H - pad.b + 6
  return (
    <Frame label={label} height={H}>
      {[0.25, 0.5, 0.75].map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} style={{ stroke: t === 0.5 ? PALETTE.muted : PALETTE.border }} strokeWidth={t === 0.5 ? 1 : 0.5} />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" style={MONO}>{t.toFixed(2)}</text>
        </g>
      ))}
      {years.map(({ year, i }, k) => (
        <g key={year}>
          <line x1={xi(i)} x2={xi(i)} y1={pad.t} y2={yStrip + strip} style={{ stroke: PALETTE.border }} strokeWidth={0.5} />
          {(everyYear || k % 2 === 0) && (
            <text x={xi(i) + 2} y={H - 6} style={MONO}>{`’${String(year).slice(2)}`}</text>
          )}
        </g>
      ))}
      {buckets.map((b, c) => (
        <rect key={c} x={b.x - bw / 2} width={bw} y={y(b.hi)} height={Math.max(0.5, y(b.lo) - y(b.hi))} style={{ fill: PALETTE.brand, opacity: 0.1 }} />
      ))}
      <polyline fill="none" points={line('ym')} style={{ stroke: PALETTE.muted }} strokeWidth={1} strokeDasharray="3 2" />
      <polyline fill="none" points={line('pm')} style={{ stroke: PALETTE.brand }} strokeWidth={1.75} />
      {buckets.map((b, c) => (
        <rect key={`s${c}`} x={b.x - bw / 2} width={bw + 0.3} y={yStrip} height={strip}
          style={{ fill: b.share >= 0.5 ? PALETTE.pos : PALETTE.neg, opacity: 0.15 + 0.85 * Math.min(1, Math.abs(b.share - 0.5) * 2) }} />
      ))}
      <text x={pad.l - 6} y={yStrip + strip - 3} textAnchor="end" style={AXIS}>real</text>
    </Frame>
  )
}

/** Null distribution of AUCs from label-shuffled refits, with the real score marked. */
export function PermutationHistogram({ nullAucs, realAuc, null95 }: { nullAucs: number[]; realAuc: number; null95: number }) {
  const H = 190
  const pad = { l: 12, r: 12, t: 22, b: 24 }
  const all = [...nullAucs, realAuc]
  const lo = Math.floor(Math.min(...all, 0.3) * 20) / 20
  const hi = Math.ceil(Math.max(...all, 0.7) * 20) / 20
  const nb = Math.round((hi - lo) / 0.025)
  const counts = new Array(nb).fill(0) as number[]
  for (const a of nullAucs) counts[Math.min(nb - 1, Math.max(0, Math.floor((a - lo) / 0.025)))]++
  const max = Math.max(...counts, 1)
  const x = (v: number) => pad.l + ((v - lo) / (hi - lo)) * (W - pad.l - pad.r)
  const bw = (W - pad.l - pad.r) / nb
  const yb = H - pad.b
  const ticks: number[] = []
  for (let v = lo; v <= hi + 1e-9; v += 0.1) ticks.push(Number(v.toFixed(2)))
  return (
    <Frame label={`Permutation null: ${nullAucs.length} shuffled AUCs; 95th percentile ${fmtNum(null95, 3)}; real AUC ${fmtNum(realAuc, 3)}`} height={H}>
      {counts.map((c, i) => (
        <rect key={i} x={pad.l + i * bw + 1} width={bw - 2} y={yb - (c / max) * (yb - pad.t)} height={(c / max) * (yb - pad.t)} rx={1} style={{ fill: PALETTE.faint, opacity: 0.7 }} />
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={yb} y2={yb} style={{ stroke: PALETTE.border }} />
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={H - 8} textAnchor="middle" style={MONO}>{t.toFixed(1)}</text>
      ))}
      <line x1={x(null95)} x2={x(null95)} y1={pad.t} y2={yb} style={{ stroke: PALETTE.muted }} strokeDasharray="3 3" />
      <text x={x(null95) + 4} y={pad.t + 8} style={AXIS}>null 95%</text>
      <line x1={x(realAuc)} x2={x(realAuc)} y1={pad.t - 12} y2={yb} style={{ stroke: PALETTE.brand }} strokeWidth={2} />
      <text x={x(realAuc)} y={pad.t - 14} textAnchor="middle" style={{ ...MONO, fill: PALETTE.brand }}>{`real ${realAuc.toFixed(3)}`}</text>
    </Frame>
  )
}

/** Permutation importance (drop in AUC when a feature is shuffled) with ±1 sd whiskers. */
export function ImportanceBars({ items }: { items: MlImportance[] }) {
  const rowH = 20
  const pad = { l: 150, r: 56, t: 6, b: 6 }
  const H = pad.t + pad.b + items.length * rowH
  const ext = Math.max(0.01, ...items.map((i) => Math.abs(i.mean) + i.std))
  const x0 = pad.l + (W - pad.l - pad.r) / 2
  const sx = (v: number) => x0 + (v / ext) * ((W - pad.l - pad.r) / 2)
  return (
    <Frame label={`Permutation importance: ${items.map((i) => `${i.feature} ${fmtNum(i.mean, 3)}`).join(', ')}`} height={H}>
      <line x1={x0} x2={x0} y1={pad.t} y2={H - pad.b} style={{ stroke: PALETTE.border }} />
      {items.map((it, i) => {
        const y = pad.t + i * rowH
        return (
          <g key={it.feature}>
            <text x={pad.l - 8} y={y + 13} textAnchor="end" style={{ ...MONO, fill: PALETTE.foreground }}>{it.feature}</text>
            <rect x={Math.min(x0, sx(it.mean))} width={Math.max(1, Math.abs(sx(it.mean) - x0))} y={y + 5} height={10} rx={1.5}
              style={{ fill: it.mean > 0 ? PALETTE.brand : PALETTE.faint, opacity: 0.85 }} />
            <line x1={sx(it.mean - it.std)} x2={sx(it.mean + it.std)} y1={y + 10} y2={y + 10} style={{ stroke: PALETTE.muted }} />
            <text x={W - 4} y={y + 13} textAnchor="end" style={MONO}>{fmtNum(it.mean, 3)}</text>
          </g>
        )
      })}
    </Frame>
  )
}

/** Reliability diagram: observed up-frequency vs mean predicted probability per bin. */
export function ReliabilityDiagram({ bins }: { bins: MlCalibrationBin[] }) {
  const S = 320
  const pad = { l: 36, r: 10, t: 10, b: 30 }
  const inner = S - pad.l - pad.r
  const x = (v: number) => pad.l + v * inner
  const y = (v: number) => pad.t + (1 - v) * (S - pad.t - pad.b)
  const pts = bins.filter((b) => b.count > 0 && b.meanPredicted != null && b.observed != null)
  const maxN = Math.max(1, ...pts.map((b) => b.count))
  return (
    <svg viewBox={`0 0 ${S} ${S}`} role="img" className="h-auto w-full max-w-md overflow-visible"
      aria-label={`Reliability: ${pts.map((b) => `predicted ${fmtPct(b.meanPredicted, 0)} observed ${fmtPct(b.observed, 0)} (n=${b.count})`).join('; ')}`}>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} style={{ stroke: PALETTE.border }} strokeWidth={0.5} />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" style={MONO}>{t.toFixed(2)}</text>
          <text x={x(t)} y={S - pad.b + 14} textAnchor="middle" style={MONO}>{t.toFixed(2)}</text>
        </g>
      ))}
      <text x={x(0.5)} y={S - 2} textAnchor="middle" style={AXIS}>predicted P(up)</text>
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} style={{ stroke: PALETTE.muted }} strokeDasharray="4 3" />
      <polyline fill="none" points={pts.map((b) => `${x(b.meanPredicted!)},${y(b.observed!)}`).join(' ')} style={{ stroke: PALETTE.brand }} strokeWidth={1.5} />
      {pts.map((b) => (
        <circle key={b.lo} cx={x(b.meanPredicted!)} cy={y(b.observed!)} r={2.5 + 5 * Math.sqrt(b.count / maxN)} style={{ fill: PALETTE.brand, fillOpacity: 0.35, stroke: PALETTE.brand }} />
      ))}
    </svg>
  )
}
