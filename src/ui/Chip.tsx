import clsx from 'clsx'
import type { ReactNode } from 'react'

export type ChipTone = 'strong' | 'moderate' | 'watch' | 'avoid' | 'neutral' | 'modeled' | 'brand'

/** Compact status label. Colour is never the only signal: always carries text. */
export function Chip({ tone = 'neutral', children, className, title }: { tone?: ChipTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        `chip-${tone}`,
        'inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-px text-2xs font-medium uppercase tracking-wider ring-1 ring-inset',
        className,
      )}
    >
      {children}
    </span>
  )
}
