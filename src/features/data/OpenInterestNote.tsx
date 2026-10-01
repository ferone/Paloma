import type { OpenInterestCoverage } from '@shared/marketdata'
import { oiLine, oiMissing } from './openInterest'

/** Per-root open-interest coverage, stated from the data (never implies full history). */
export function OpenInterestNote({ rows, className }: { rows: readonly OpenInterestCoverage[] | undefined; className?: string }) {
  if (!rows?.length) return null
  const lines = rows.map(oiLine).filter((l): l is string => l != null)
  const missing = oiMissing(rows)
  return (
    <div className={className}>
      <ul className="space-y-0.5 text-2xs text-muted">
        {lines.map((l) => (
          <li key={l} className="num">
            {l}
          </li>
        ))}
        {missing.length > 0 && (
          <li>
            No open interest yet for <span className="num">{missing.join(', ')}</span>.
          </li>
        )}
      </ul>
      <p className="mt-1 text-2xs text-faint">Open interest is not backfilled: the daily Databento job collects it from each run onward.</p>
    </div>
  )
}
