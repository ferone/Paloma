import clsx from 'clsx'
import type { ReactNode } from 'react'
import { Provenance, type ProvenanceProps } from './Provenance'

interface PanelProps {
  title?: ReactNode
  /** Small-caps line above the title (section or instrument). */
  eyebrow?: ReactNode
  /** Right-aligned controls in the header (tabs, range selector, actions). */
  actions?: ReactNode
  /** Footer provenance: source, data-through date, modeled flag. */
  provenance?: ProvenanceProps
  /** `dense` for terminal views (tighter padding, smaller title). */
  density?: 'comfortable' | 'dense'
  className?: string
  bodyClassName?: string
  children: ReactNode
  as?: 'section' | 'article' | 'div'
}

/**
 * The one container. Hierarchy comes from spacing and type, not borders on
 * borders: panels never nest visually (use <Panel.Divider/> or plain spacing).
 */
export function Panel({
  title,
  eyebrow,
  actions,
  provenance,
  density = 'comfortable',
  className,
  bodyClassName,
  children,
  as: Tag = 'section',
}: PanelProps) {
  const dense = density === 'dense'
  const hasHeader = title || eyebrow || actions
  return (
    <Tag
      className={clsx(
        // min-w-0: inside grids/flex a wide table must scroll within the panel,
        // not stretch the panel (and the page) past the viewport.
        'min-w-0 rounded-lg border border-border bg-surface shadow-[var(--shadow-panel)]',
        dense ? 'p-3' : 'p-4 sm:p-5',
        className,
      )}
    >
      {hasHeader && (
        <header className={clsx('flex flex-wrap items-start justify-between gap-x-4 gap-y-2', dense ? 'mb-2' : 'mb-4')}>
          <div className="min-w-0">
            {eyebrow && <div className="label mb-1">{eyebrow}</div>}
            {title && (
              <h2 className={clsx('font-medium text-foreground', dense ? 'text-[13px]' : 'text-[15px]')}>{title}</h2>
            )}
          </div>
          {actions && <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
      {provenance && (
        <footer className={clsx('border-t border-border', dense ? 'mt-2 pt-2' : 'mt-4 pt-3')}>
          <Provenance {...provenance} />
        </footer>
      )}
    </Tag>
  )
}

Panel.Divider = function PanelDivider() {
  return <hr className="my-4 border-border" />
}
