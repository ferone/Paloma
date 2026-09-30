import type { ReactNode } from 'react'
import clsx from 'clsx'
import { RiMoonLine, RiSunLine, RiRefreshLine } from 'react-icons/ri'
import { useQuote } from '../hooks/useQuote'
import { useSettings } from '../store/settings-context'
import { useTheme } from './theme'
import { UNIVERSE } from '@shared/universe'
import { fmtNum, fmtPctSigned } from '../design/format'
import { signColor } from '../design/tokens'
import { AssetPicker } from './AssetPicker'

export function TopBar({ menuButton }: { menuButton: ReactNode }) {
  const { theme, toggleTheme } = useTheme()
  const { autoRefresh, toggleAutoRefresh } = useSettings()
  const gold = useQuote(UNIVERSE.gold.spot)
  const silver = useQuote(UNIVERSE.silver.spot)
  const ratio = gold.data && silver.data && silver.data.price > 0 ? gold.data.price / silver.data.price : null

  return (
    <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border bg-background/85 px-4 backdrop-blur md:px-8">
      {menuButton}

      <dl className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto text-xs">
        <Ticker label="Gold" price={gold.data?.price} change={gold.data?.changePercent} />
        <Ticker label="Silver" price={silver.data?.price} change={silver.data?.changePercent} />
        <div className="hidden items-baseline gap-1.5 sm:flex">
          <dt className="text-muted">Au/Ag</dt>
          <dd className="num text-foreground">{fmtNum(ratio, 1)}</dd>
        </div>
      </dl>

      <div className="flex items-center gap-1.5">
        <AssetPicker />
        <button
          type="button"
          onClick={toggleAutoRefresh}
          aria-pressed={autoRefresh}
          title={autoRefresh ? 'Live refresh on' : 'Live refresh paused'}
          className={clsx(
            'rounded-md p-1.5 transition-colors hover:bg-surface-2',
            autoRefresh ? 'text-brand' : 'text-faint',
          )}
        >
          <RiRefreshLine size={16} className={autoRefresh ? 'motion-safe:animate-[spin_6s_linear_infinite]' : ''} />
          <span className="sr-only">Toggle live refresh</span>
        </button>
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <RiSunLine size={16} /> : <RiMoonLine size={16} />}
        </button>
      </div>
    </header>
  )
}

function Ticker({ label, price, change }: { label: string; price?: number; change?: number }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <dt className="text-muted">{label}</dt>
      <dd className="num text-foreground">{price ? `$${fmtNum(price, 2)}` : '—'}</dd>
      <dd className={clsx('num', signColor(change))}>{change != null ? fmtPctSigned(change / 100) : ''}</dd>
    </div>
  )
}
