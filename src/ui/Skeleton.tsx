import clsx from 'clsx'

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx('animate-pulse rounded bg-surface-2', className)} />
}

/** Standard loading placeholder for a panel body. */
export function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={clsx('h-4', i === 0 ? 'w-1/3' : 'w-full')} />
      ))}
    </div>
  )
}

/** Error message block for failed queries. */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Request failed'
  return (
    <div role="alert" className="rounded-md border border-neg/30 bg-neg/5 px-3 py-2 text-xs text-neg-text">
      {message}
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-2 underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  )
}
