import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

/** Editorial page title: serif display headline, muted one-line purpose. */
export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <div className="label mb-2">{eyebrow}</div>}
        <h1 className="display text-[clamp(1.75rem,2.6vw,2.25rem)] font-normal leading-tight text-foreground">{title}</h1>
        {description && <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
