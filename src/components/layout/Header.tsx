import { useSettings } from '../../store/settings-context'
import { RiRefreshLine } from 'react-icons/ri'
import clsx from 'clsx'

export function Header() {
  const { autoRefresh, toggleAutoRefresh } = useSettings()

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between px-6 py-3 bg-gray-900/80 backdrop-blur border-b border-gray-800">
      <div className="md:hidden w-10" />
      <h2 className="text-sm font-medium text-gray-400 hidden md:block">Gold Investment Dashboard</h2>
      <button
        onClick={toggleAutoRefresh}
        className={clsx(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
          autoRefresh
            ? 'bg-gold-500/10 text-gold-400 border border-gold-500/30'
            : 'bg-gray-800 text-gray-400 border border-gray-700 hover:text-white'
        )}
      >
        <RiRefreshLine size={14} className={autoRefresh ? 'animate-spin' : ''} />
        Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
      </button>
    </header>
  )
}
