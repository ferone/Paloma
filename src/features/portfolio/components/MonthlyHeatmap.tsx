import type { CSSProperties } from 'react'
import type { MonthlyReturnsRow } from '@shared/portfolio'
import { fmtPctSigned } from '../../../design/format'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Diverging fill: neutral surface at 0, toward --pos / --neg with magnitude. */
function returnColor(v: number, scaleMax: number): string {
  const t = Math.round(Math.min(1, Math.abs(v) / (scaleMax || 1)) * 70)
  return `color-mix(in oklch, var(--surface-2), var(--${v >= 0 ? 'pos' : 'neg'}) ${t}%)`
}

/**
 * Year × month table of NAV/unit returns with a YTD column, colour-scaled on
 * a diverging pos/neg ramp (ported from CommodityFutures SeasonalReturnsHeatmap).
 * Values are always printed, so colour is never the only signal.
 */
export function MonthlyHeatmap({ rows }: { rows: MonthlyReturnsRow[] }) {
  const all = rows.flatMap((r) => r.months.filter((m): m is number => m != null).map(Math.abs))
  const scaleMax = (all.length ? Math.max(...all) : 0.05) * 0.7 || 0.05
  const cell = (v: number | null): CSSProperties => ({ background: v == null ? 'transparent' : returnColor(v, scaleMax) })

  const avg = MON.map((_, m) => {
    const xs = rows.map((r) => r.months[m]).filter((x): x is number => x != null)
    return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null
  })
  const pctPos = MON.map((_, m) => {
    const xs = rows.map((r) => r.months[m]).filter((x): x is number => x != null)
    return xs.length ? xs.filter((x) => x > 0).length / xs.length : null
  })

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-separate border-spacing-[2px] text-right text-[11px]">
        <caption className="sr-only">Monthly returns of NAV per unit by year, with year-to-date</caption>
        <thead>
          <tr className="text-muted">
            <th scope="col" className="sticky left-0 z-10 bg-surface px-2 py-1 text-left font-medium">Year</th>
            {MON.map((m) => (
              <th key={m} scope="col" className="px-1.5 py-1 font-medium">
                {m}
              </th>
            ))}
            <th scope="col" className="px-2 py-1 font-medium text-foreground">YTD</th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.map((r) => (
            <tr key={r.year}>
              <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-1 text-left font-semibold text-foreground">
                {r.year}
              </th>
              {r.months.map((v, i) => (
                <td key={i} className="rounded-[3px] px-1.5 py-1 text-foreground/90" style={cell(v)} title={v == null ? undefined : `${MON[i]} ${r.year}: ${fmtPctSigned(v)}`}>
                  {v == null ? '' : fmtPctSigned(v, 1)}
                </td>
              ))}
              <td className="rounded-[3px] px-2 py-1 font-semibold text-foreground" style={cell(r.ytd)}>
                {fmtPctSigned(r.ytd, 1)}
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot className="num text-muted">
            <tr>
              <th scope="row" className="sticky left-0 z-10 bg-surface px-2 pb-1 pt-2 text-left font-medium">
                Average
              </th>
              {avg.map((v, i) => (
                <td key={i} className="px-1.5 pb-1 pt-2">
                  {fmtPctSigned(v, 1)}
                </td>
              ))}
              <td />
            </tr>
            <tr>
              <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-1 text-left font-medium">
                % positive
              </th>
              {pctPos.map((v, i) => (
                <td key={i} className="px-1.5 py-1">
                  {v == null ? '—' : `${Math.round(v * 100)}%`}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
