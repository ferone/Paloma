import clsx from 'clsx'
import { UNIVERSE, type Metal } from '@shared/universe'
import { Chip, ErrorNote, Panel, Skeleton } from '../../../ui'
import { fmtDateTime, fmtNum, fmtPctSigned, fmtUsd, fmtUsdSigned } from '../../../design/format'
import { signColor } from '../../../design/tokens'
import { useQuote } from '../hooks'

const STATE_LABEL: Record<string, { label: string; tone: 'strong' | 'neutral' | 'watch' }> = {
  REGULAR: { label: 'Market open', tone: 'strong' },
  PRE: { label: 'Pre-market', tone: 'watch' },
  PREPRE: { label: 'Pre-market', tone: 'watch' },
  POST: { label: 'After hours', tone: 'watch' },
  POSTPOST: { label: 'After hours', tone: 'watch' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
}

/** Headline spot figure for the metal in focus (front COMEX future as spot proxy). */
export function SpotHero({ metal }: { metal: Metal }) {
  const spec = UNIVERSE[metal]
  const q = useQuote(spec.spot)
  const d = q.data
  const state = STATE_LABEL[d?.marketState ?? ''] ?? { label: d?.marketState ?? '—', tone: 'neutral' as const }
  const rangePos = d && d.dayHigh > d.dayLow ? (d.price - d.dayLow) / (d.dayHigh - d.dayLow) : null

  return (
    <Panel
      eyebrow={`${spec.label} · COMEX front future (${spec.spot})`}
      actions={d && <Chip tone={state.tone}>{state.label}</Chip>}
      provenance={{ source: `Yahoo Finance · ${spec.spot}, USD/oz`, note: d ? `updated ${fmtDateTime(d.timestamp)} · may be delayed` : undefined }}
    >
      {q.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
      ) : q.error || !d ? (
        <ErrorNote error={q.error ?? new Error('No quote')} onRetry={() => q.refetch()} />
      ) : (
        <div className="flex flex-wrap items-end gap-x-10 gap-y-5">
          <div>
            <div className="display text-[clamp(2.5rem,5vw,3.75rem)] font-light leading-none tabular-nums text-foreground">
              {fmtUsd(d.price)}
            </div>
            <div className={clsx('num mt-2 text-sm', signColor(d.change))}>
              {fmtUsdSigned(d.change)} <span className="ml-1">{fmtPctSigned(d.changePercent / 100)}</span>
              <span className="ml-2 text-xs text-muted">vs prior settle {fmtUsd(d.previousClose)}</span>
            </div>
          </div>

          <div className="min-w-56 flex-1 max-w-sm">
            <div className="label mb-1.5">Day range</div>
            <div className="relative h-1.5 rounded-full bg-surface-2" aria-hidden>
              {rangePos != null && (
                <span
                  className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-foreground"
                  style={{ left: `${Math.min(100, Math.max(0, rangePos * 100))}%` }}
                />
              )}
            </div>
            <div className="num mt-1.5 flex justify-between text-xs text-muted">
              <span>{fmtNum(d.dayLow)}</span>
              <span>{fmtNum(d.dayHigh)}</span>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
            <dt className="text-muted">Volume</dt>
            <dd className="num text-right text-foreground">{fmtNum(d.volume, 0)}</dd>
            <dt className="text-muted">Contract</dt>
            <dd className="num text-right text-foreground">{spec.futures[0].ozPerContract.toLocaleString('en-US')} oz</dd>
          </dl>
        </div>
      )}
    </Panel>
  )
}
