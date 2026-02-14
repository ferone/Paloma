import clsx from 'clsx'
import { TIME_RANGES, type TimeRange } from '../../lib/constants'

interface TimeRangeSelectorProps {
  selected: TimeRange
  onChange: (range: TimeRange) => void
}

export function TimeRangeSelector({ selected, onChange }: TimeRangeSelectorProps) {
  return (
    <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1">
      {TIME_RANGES.map((range) => (
        <button
          key={range}
          onClick={() => onChange(range)}
          className={clsx(
            'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
            selected === range
              ? 'bg-gold-500/20 text-gold-400'
              : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          )}
        >
          {range}
        </button>
      ))}
    </div>
  )
}
