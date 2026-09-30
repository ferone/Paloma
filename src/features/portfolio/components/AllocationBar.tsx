import { fmtPct, fmtUsdCompact } from '../../../design/format'

export interface AllocationItem {
  key: string
  label: string
  value: number
  weight: number
  /** CSS colour (a var()) — applied via style so it flips with the theme. */
  color: string
}

/**
 * Table-bar hybrid: one thin stacked bar for the whole, then a row per slice
 * with its own proportional bar, value and weight. Negative slices (e.g. a
 * futures sleeve carrying a loss) are listed but not drawn in the stack.
 */
export function AllocationBar({ items, caption }: { items: AllocationItem[]; caption: string }) {
  const positive = items.filter((i) => i.value > 0)
  const total = positive.reduce((s, i) => s + i.value, 0)
  const max = Math.max(...items.map((i) => Math.abs(i.weight)), 0.0001)
  return (
    <figure>
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-sm" role="img" aria-label={`${caption}: ${items.map((i) => `${i.label} ${fmtPct(i.weight, 1)}`).join(', ')}`}>
        {positive.map((i) => (
          <div key={i.key} title={`${i.label} ${fmtPct(i.weight, 1)}`} style={{ width: `${(i.value / total) * 100}%`, background: i.color }} />
        ))}
      </div>
      <table className="mt-3 w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <tbody>
          {items.map((i) => (
            <tr key={i.key} className="border-b border-border/50 last:border-0">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-foreground">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="inline-block h-2 w-2 rounded-[2px]" style={{ background: i.color }} />
                  {i.label}
                </span>
              </th>
              <td className="w-[38%] py-1.5 pr-3" aria-hidden>
                <div className="h-1 rounded-full bg-surface-2">
                  <div className="h-1 rounded-full" style={{ width: `${(Math.max(0, i.weight) / max) * 100}%`, background: i.color }} />
                </div>
              </td>
              <td className="num py-1.5 pr-3 text-right text-muted">{fmtUsdCompact(i.value)}</td>
              <td className="num w-16 py-1.5 text-right text-foreground">{fmtPct(i.weight, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
