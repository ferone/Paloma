import type { IconType } from 'react-icons'
import {
  RiDashboardHorizontalLine,
  RiBriefcase4Line,
  RiLineChartLine,
  RiFunctionLine,
  RiGlobalLine,
  RiBrainLine,
  RiDatabase2Line,
  RiFileChartLine,
  RiSettings3Line,
} from 'react-icons/ri'

export interface NavItem {
  to: string
  label: string
  icon: IconType
  /** Match only the exact path (for "/"). */
  end?: boolean
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

// Information architecture. Fund = what we own; Research = where to act next;
// System = plumbing. Order is deliberate: most-used first within each group.
export const NAV: NavGroup[] = [
  {
    label: 'Fund',
    items: [
      { to: '/', label: 'Overview', icon: RiDashboardHorizontalLine, end: true },
      { to: '/portfolio', label: 'Portfolio', icon: RiBriefcase4Line },
      { to: '/investor', label: 'Investor report', icon: RiFileChartLine },
    ],
  },
  {
    label: 'Research',
    items: [
      { to: '/markets', label: 'Markets', icon: RiLineChartLine },
      { to: '/quant', label: 'Quant Lab', icon: RiFunctionLine },
      { to: '/macro', label: 'Macro & AI', icon: RiGlobalLine },
      { to: '/intelligence', label: 'Intelligence', icon: RiBrainLine },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/data', label: 'Data Center', icon: RiDatabase2Line },
      { to: '/settings', label: 'Settings', icon: RiSettings3Line },
    ],
  },
]
