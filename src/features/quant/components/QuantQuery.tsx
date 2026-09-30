import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { isQuantEmpty, type QuantEmpty } from '@shared/quant'
import { Button, EmptyState, ErrorNote, PanelSkeleton } from '../../../ui'
import { useRecompute } from '../api'

/** Loading / error / honest-empty / data switch for any quant query. */
export function QuantQuery<T>({ q, rows = 5, children }: { q: UseQueryResult<T | QuantEmpty>; rows?: number; children: (data: T) => ReactNode }) {
  if (q.isPending) return <PanelSkeleton rows={rows} />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
  const d = q.data
  if (isQuantEmpty(d)) return <QuantEmptyState empty={d} />
  return <>{children(d as T)}</>
}

export function QuantEmptyState({ empty, compact }: { empty: QuantEmpty; compact?: boolean }) {
  const recompute = useRecompute()
  const title =
    empty.status === 'no_data' ? 'No contract history yet' : empty.status === 'computing' ? 'The engine is running' : 'The engine has not run yet'
  return (
    <EmptyState
      compact={compact}
      title={title}
      action={
        empty.status === 'not_computed' ? (
          <Button variant="primary" size="sm" disabled={recompute.isPending} onClick={() => recompute.mutate()}>
            Recompute now
          </Button>
        ) : empty.status === 'no_data' ? (
          <Link to="/data" className="text-sm text-brand underline underline-offset-2">
            Open the Data Center
          </Link>
        ) : undefined
      }
    >
      <p>{empty.message}</p>
      <p className="mt-1">{empty.action}</p>
      {empty.status === 'computing' && <p className="mt-2 animate-pulse text-faint">Working…</p>}
    </EmptyState>
  )
}
