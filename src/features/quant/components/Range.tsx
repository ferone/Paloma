import { useMemo, useState } from 'react'
import { Segmented } from '../../../ui'

export type RangeKey = '1Y' | '3Y' | '5Y' | 'All'
const YEARS: Record<RangeKey, number | null> = { '1Y': 1, '3Y': 3, '5Y': 5, All: null }

/** Date-range selector state + a slicer for any `{date}` array. */
// eslint-disable-next-line react-refresh/only-export-components
export function useRange(initial: RangeKey = '3Y') {
  const [range, setRange] = useState<RangeKey>(initial)
  const slice = useMemo(
    () =>
      <T extends { date: string }>(rows: T[]): T[] => {
        const yrs = YEARS[range]
        if (!yrs || rows.length === 0) return rows
        const last = rows[rows.length - 1].date
        const cut = `${Number(last.slice(0, 4)) - yrs}${last.slice(4)}`
        return rows.filter((r) => r.date >= cut)
      },
    [range],
  )
  return { range, setRange, slice }
}

export function RangeControl({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return <Segmented<RangeKey> ariaLabel="Chart range" value={value} onChange={onChange} options={['1Y', '3Y', '5Y', 'All']} />
}
