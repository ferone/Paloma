import type { ReactNode } from 'react'

/** Collapsible "How to read this" block. Native <details>: no JS, keyboard-accessible. */
export function Explainer({ title = 'How to read this', children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <details className="group rounded-md border border-border bg-surface-2/50 text-xs">
      <summary className="cursor-pointer select-none list-none px-3 py-2 text-muted hover:text-foreground">
        <span className="mr-1.5 inline-block transition-transform group-open:rotate-90" aria-hidden>
          ›
        </span>
        {title}
      </summary>
      <div className="space-y-2 px-3 pb-3 leading-relaxed text-muted">{children}</div>
    </details>
  )
}

/** Inline definition tooltip for jargon (z-score, contango, TWR…). */
export function HelpTip({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <span className="group relative inline-flex items-center">
      <span className="cursor-help border-b border-dotted border-muted">{term}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-md border border-border bg-surface-3 px-3 py-2 text-xs leading-relaxed text-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {children}
      </span>
    </span>
  )
}
