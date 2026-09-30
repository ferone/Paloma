import clsx from 'clsx'
import { NavLink } from 'react-router-dom'

export interface TabItem {
  to: string
  label: string
  end?: boolean
}

/** Route-driven sub-navigation within a section (deep-linkable, back-button safe). */
export function RouteTabs({ items }: { items: TabItem[] }) {
  return (
    <nav aria-label="Section" className="-mt-2 mb-6 flex gap-5 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            clsx(
              '-mb-px whitespace-nowrap border-b-2 pb-2.5 text-sm transition-colors',
              isActive ? 'border-brand text-foreground' : 'border-transparent text-muted hover:text-foreground',
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
