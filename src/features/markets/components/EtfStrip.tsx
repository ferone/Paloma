import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { UNIVERSE, type AssetId } from '@shared/universe'
import { EmptyState, ErrorNote, Panel, Skeleton } from '../../../ui'
import { fmtCompact, fmtNum, fmtPctSigned } from '../../../design/format'
import { signColor } from '../../../design/tokens'
import { useQuotes } from '../hooks'

// Literal class strings (Tailwind only generates classes it can see in source).
const STRIP_COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
}

/** Dense quote strip: the asset's physically backed / spot ETFs plus its miners ETF (when it has one). */
export function EtfStrip({ metal }: { metal: AssetId }) {
  const spec = UNIVERSE[metal]
  const symbols = spec.miners ? [...spec.etfs, spec.miners] : spec.etfs
  const q = useQuotes(symbols)
  const bySymbol = new Map((q.data ?? []).map((x) => [x.symbol, x]))

  return (
    <Panel
      density="dense"
      title={spec.miners ? `${spec.label} ETFs & miners` : `${spec.label} ETFs`}
      actions={
        <Link to="/markets/etfs" className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline">
          Premiums & tracking →
        </Link>
      }
      provenance={{ source: 'Yahoo Finance quotes · may be delayed' }}
    >
      {symbols.length === 0 ? (
        <EmptyState compact title={`No listed funds for ${spec.label.toLowerCase()}`}>
          The universe has no ETF or miners proxy for {spec.label.toLowerCase()}, so there is nothing to quote here.
        </EmptyState>
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : (
        // Columns follow the fund count so the 1px border background never shows as empty cells.
        <ul className={clsx('grid gap-px overflow-hidden rounded-md border border-border bg-border', STRIP_COLS[Math.min(symbols.length, 6)])}>
          {symbols.map((s) => {
            const d = bySymbol.get(s)
            const miners = s === spec.miners
            return (
              <li key={s} className="bg-surface px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="num text-[13px] font-medium text-foreground">{s}</span>
                  {miners && <span className="label text-faint">Miners</span>}
                </div>
                {q.isLoading ? (
                  <Skeleton className="mt-2 h-4 w-20" />
                ) : d ? (
                  <>
                    <div className="mt-1 flex items-baseline justify-between gap-2">
                      <span className="num text-sm text-foreground">{fmtNum(d.price)}</span>
                      <span className={clsx('num text-xs', signColor(d.changePercent))}>{fmtPctSigned(d.changePercent / 100)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-2xs text-muted" title={d.shortName}>
                      Vol <span className="num">{fmtCompact(d.volume)}</span> · {d.shortName.replace(/^"|"$/g, '')}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-xs text-muted">No quote</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
