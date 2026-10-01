import type { ReactNode } from 'react'
import clsx from 'clsx'
import { RiMoonLine, RiSunLine, RiRefreshLine } from 'react-icons/ri'
import { useSettings } from '../store/settings-context'
import { useTheme } from './theme'
import { AssetPicker } from './AssetPicker'
import { TickerStrip } from './TickerStrip'
import { AssistantToggle } from '../features/assistant/AssistantProvider'

export function TopBar({ menuButton }: { menuButton: ReactNode }) {
  const { theme, toggleTheme } = useTheme()
  const { autoRefresh, toggleAutoRefresh } = useSettings()

  return (
    <header className="no-print sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-background/85 px-4 pt-2 pb-1.5 backdrop-blur sm:h-14 sm:flex-nowrap sm:py-0 md:px-8">
      {menuButton}

      {/* Phones: the ticker gets its own full-width row under the controls. */}
      <div className="order-last flex min-w-0 basis-full sm:order-none sm:basis-auto sm:flex-1">
        <TickerStrip />
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:ml-0">
        <AssetPicker />
        <button
          type="button"
          onClick={toggleAutoRefresh}
          aria-pressed={autoRefresh}
          title={autoRefresh ? 'Live refresh on' : 'Live refresh paused'}
          className={clsx(
            'rounded-md p-1.5 transition-colors hover:bg-surface-2 pointer-coarse:p-2.5',
            autoRefresh ? 'text-brand' : 'text-faint',
          )}
        >
          <RiRefreshLine size={16} className={autoRefresh ? 'motion-safe:animate-[spin_6s_linear_infinite]' : ''} />
          <span className="sr-only">Toggle live refresh</span>
        </button>
        <AssistantToggle />
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground pointer-coarse:p-2.5"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <RiSunLine size={16} /> : <RiMoonLine size={16} />}
        </button>
      </div>
    </header>
  )
}
