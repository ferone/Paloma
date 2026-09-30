import type { ReactNode } from 'react'
import clsx from 'clsx'
import { RiMoonLine, RiSunLine, RiRefreshLine } from 'react-icons/ri'
import { useSettings } from '../store/settings-context'
import { useTheme } from './theme'
import { AssetPicker } from './AssetPicker'
import { TickerStrip } from './TickerStrip'

export function TopBar({ menuButton }: { menuButton: ReactNode }) {
  const { theme, toggleTheme } = useTheme()
  const { autoRefresh, toggleAutoRefresh } = useSettings()

  return (
    <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border bg-background/85 px-4 backdrop-blur md:px-8">
      {menuButton}

      <TickerStrip />

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
