import { useState } from 'react'
import clsx from 'clsx'
import type { RegionData, CountryDemand } from '../../types'
import { formatDollarVolume } from '../../lib/format'

export function CountryRow({ country }: { country: CountryDemand }) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-800/50 transition-colors">
      <span className="text-lg leading-none">{country.flag}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm text-gray-200">{country.country}</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{country.percent}%</span>
            <span className="text-xs font-mono text-gray-300">{formatDollarVolume(country.volume)}</span>
          </div>
        </div>
        {/* Stacked demand bar */}
        <div className="flex h-1.5 rounded-full overflow-hidden bg-gray-800">
          {country.breakdown.map((b) => (
            <div
              key={b.type}
              className="h-full"
              style={{ width: `${b.percent}%`, backgroundColor: b.color }}
              title={`${b.type}: ${b.percent}%`}
            />
          ))}
        </div>
        <div className="flex gap-2 mt-1 flex-wrap">
          {country.breakdown.map((b) => (
            <span key={b.type} className="text-[10px] text-gray-500 flex items-center gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: b.color }} />
              {b.type} {b.percent}%
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export function RegionSection({ region }: { region: RegionData }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-gray-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: region.color }} />
          <span className="text-sm font-medium text-white">{region.region}</span>
          <span className="text-xs text-gray-500">({region.countries.length} countries)</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-300">{region.percent}%</span>
          <svg
            className={clsx('w-4 h-4 text-gray-500 transition-transform', expanded && 'rotate-180')}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-gray-800 px-1 py-1 space-y-0.5">
          {region.countries.map((c) => (
            <CountryRow key={c.country} country={c} />
          ))}
        </div>
      )}
    </div>
  )
}
