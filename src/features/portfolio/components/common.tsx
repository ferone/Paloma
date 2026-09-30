import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../../../ui'

/** The one call to action for an empty ledger. */
export function RecordFirstTransaction({ title = 'No transactions recorded yet', children }: { title?: string; children?: ReactNode }) {
  return (
    <EmptyState
      title={title}
      action={
        <Link
          to="/portfolio/ledger?new=1"
          className="inline-flex h-9 items-center rounded-md bg-foreground px-3.5 text-sm font-medium text-background hover:bg-foreground/85"
        >
          Record your first transaction
        </Link>
      }
    >
      {children ?? 'Holdings, NAV, performance and risk are all derived from the ledger. Record a subscription and your first trades, or import a CSV.'}
    </EmptyState>
  )
}

export function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <div role="status" className="rounded-md border border-tier-watch/40 bg-tier-watch/5 px-4 py-3 text-xs text-foreground">
      <p className="label mb-1 text-tier-watch-text">Ledger checks</p>
      <ul className="list-disc space-y-0.5 pl-4 text-muted">
        {items.slice(0, 8).map((w) => (
          <li key={w}>{w}</li>
        ))}
        {items.length > 8 && <li>…and {items.length - 8} more</li>}
      </ul>
    </div>
  )
}
