import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { NotConfigured } from '@shared/api'

interface EmptyStateProps {
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  compact?: boolean
}

/** Honest empty state: says what is missing and how to get it. Never a fake chart. */
export function EmptyState({ title, children, action, compact }: EmptyStateProps) {
  return (
    <div className={compact ? 'py-6 text-center' : 'py-12 text-center'}>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

/** Rendered when a server response is `{ status: 'not_configured' }`. */
export function NotConfiguredState({ info }: { info: NotConfigured }) {
  return (
    <EmptyState
      title="Integration not configured"
      action={
        <Link to="/settings" className="text-sm text-brand underline underline-offset-2">
          Open Settings → API keys
        </Link>
      }
    >
      <p>{info.message}</p>
      <p className="mt-2">
        Add{' '}
        {info.missing.map((m, i) => (
          <span key={m}>
            {i > 0 && ', '}
            <code className="num rounded bg-surface-2 px-1 py-px text-foreground">{m}</code>
          </span>
        ))}{' '}
        in Settings. It takes effect immediately, with no restart.
      </p>
    </EmptyState>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function isNotConfigured(x: unknown): x is NotConfigured {
  return typeof x === 'object' && x !== null && (x as { status?: string }).status === 'not_configured'
}
