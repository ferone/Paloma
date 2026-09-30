import { fmtNum, fmtSigned } from '../design/format'
import { divergingColor } from './util'

export interface MonthlyCell {
  year: number
  month: number
  ret: number | null
}

export interface MonthlySummaryRow {
  month: number
  pctPositive: number
  median: number
  avg: number
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Month × year returns grid (close of month vs close of prior month). Percent for
 * price-like series; absolute change for spreads that sit near zero. Colour
 * saturates at the 90th percentile of |return| so one outlier doesn't wash it out.
 */
export function SeasonalReturnsHeatmap({ cells, years, summary, basis, unit }: { cells: MonthlyCell[]; years: number[]; summary: MonthlySummaryRow[]; basis: 'pct' | 'abs'; unit?: string }) {
  const by = new Map(cells.map((c) => [`${c.year}-${c.month}`, c.ret]))
  const mags = cells.map((c) => Math.abs(c.ret ?? 0)).sort((a, b) => a - b)
  const scaleMax = mags[Math.floor(mags.length * 0.9)] || 1
  const fmt = (v: number | null | undefined) => (v == null ? '' : basis === 'pct' ? `${fmtSigned(v, 1)}` : fmtSigned(v, 2))
  const sum = new Map(summary.map((s) => [s.month, s]))
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-px text-2xs">
        <caption className="sr-only">Monthly returns by year ({basis === 'pct' ? 'percent' : `change in ${unit ?? 'value'}`})</caption>
        <thead>
          <tr>
            <th scope="col" className="label px-1.5 py-1 text-left font-medium">Year</th>
            {MON.map((m) => (
              <th key={m} scope="col" className="label px-1 py-1 text-right font-medium">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...years].reverse().map((y) => (
            <tr key={y}>
              <th scope="row" className="num px-1.5 py-0.5 text-left font-normal text-muted">
                {y}
              </th>
              {MON.map((_, i) => {
                const v = by.get(`${y}-${i + 1}`)
                return (
                  <td key={i} className="num px-1 py-0.5 text-right text-foreground" style={{ background: divergingColor(v, scaleMax) }} title={v == null ? undefined : `${MON[i]} ${y}: ${fmt(v)}${basis === 'pct' ? '%' : ''}`}>
                    {fmt(v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="label px-1.5 pt-2 text-left font-medium">Up %</th>
            {MON.map((_, i) => (
              <td key={i} className="num px-1 pt-2 text-right text-muted">
                {sum.get(i + 1) ? `${fmtNum(sum.get(i + 1)!.pctPositive, 0)}` : ''}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className="label px-1.5 text-left font-medium">Median</th>
            {MON.map((_, i) => {
              const s = sum.get(i + 1)
              return (
                <td key={i} className="num px-1 text-right text-foreground" style={{ background: divergingColor(s?.median, scaleMax) }}>
                  {s ? fmt(s.median) : ''}
                </td>
              )
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
