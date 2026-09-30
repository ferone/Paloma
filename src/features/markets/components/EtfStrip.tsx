import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { UNIVERSE, type Metal } from '@shared/universe'
import { ErrorNote, Panel, Skeleton } from '../../../ui'
import { fmtCompact, fmtNum, fmtPctSigned } from '../../../design/format'
import { signColor } from '../../../design/tokens'
import { useQuotes } from '../hooks'

/** Dense quote strip: the metal's physically backed ETFs plus its miners ETF. */
export function EtfStrip({ metal }: { metal: Metal }) {
  const spec = UNIVERSE[metal]
  const symbols = [...spec.etfs, spec.miners]
  const q = useQuotes(symbols)
  const bySymbol = new Map((q.data ?? []).map((x) => [x.symbol, x]))

  return (
    <Panel
      density="dense"
      title={`${spec.label} ETFs & miners`}
      actions={
        <Link to="/markets/etfs" className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline">
          Premiums & tracking →
        </Link>
      }
      provenance={{ source: 'Yahoo Finance quotes · may be delayed' }}
    >
      {q.error ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
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
