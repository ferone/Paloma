import { Suspense, type ReactNode } from 'react'
import { ErrorBoundary, PanelSkeleton } from '../ui'

/** Wrap a lazily-loaded page with an error boundary and a skeleton fallback. */
export function page(node: ReactNode): ReactNode {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PanelSkeleton rows={6} />}>{node}</Suspense>
    </ErrorBoundary>
  )
}
