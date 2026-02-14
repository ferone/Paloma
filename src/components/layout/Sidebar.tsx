import { NavLink } from 'react-router-dom'
import { RiDashboardLine, RiExchangeLine, RiSignalTowerLine, RiPieChartLine, RiDropLine, RiMenuLine, RiCloseLine } from 'react-icons/ri'
import { useState } from 'react'
import clsx from 'clsx'

const navItems = [
  { to: '/', label: 'Dashboard', icon: RiDashboardLine },
  { to: '/comparison', label: 'Comparison', icon: RiExchangeLine },
  { to: '/signals', label: 'Signals', icon: RiSignalTowerLine },
  { to: '/liquidity', label: 'Liquidity', icon: RiDropLine },
  { to: '/simulator', label: 'Simulator', icon: RiPieChartLine },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-gray-800 text-gray-300 hover:text-white md:hidden"
      >
        {collapsed ? <RiCloseLine size={20} /> : <RiMenuLine size={20} />}
      </button>

      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex flex-col bg-gray-900 border-r border-gray-800 transition-transform duration-200',
          'w-64 md:translate-x-0',
          collapsed ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-800">
          <div className="w-8 h-8 rounded-lg bg-gold-500 flex items-center justify-center text-gray-900 font-bold text-lg">
            P
          </div>
          <span className="text-xl font-bold text-white">Paloma</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setCollapsed(false)}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-gold-500/10 text-gold-400'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                )
              }
            >
              <item.icon size={20} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-6 py-4 border-t border-gray-800">
          <p className="text-xs text-gray-500">Gold Investment Dashboard</p>
        </div>
      </aside>
    </>
  )
}
