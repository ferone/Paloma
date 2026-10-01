import { NavLink, Outlet } from 'react-router-dom'
import { useState } from 'react'
import clsx from 'clsx'
import { RiMenuLine, RiCloseLine } from 'react-icons/ri'
import { NAV } from './nav'
import { TopBar } from './TopBar'
import { AdminGate } from './AdminGate'
import { AssistantDock, AssistantInset, AssistantLauncher, AssistantProvider } from '../features/assistant/AssistantProvider'

export function AppShell() {
  const [open, setOpen] = useState(false)

  return (
    <AssistantProvider>
      <div className="min-h-dvh bg-background">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>

        <aside
          className={clsx(
            'no-print fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-surface transition-transform duration-200 lg:translate-x-0',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
          aria-label="Primary"
        >
          <div className="flex h-14 items-center gap-2.5 border-b border-border px-5">
            <Wordmark />
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-4">
            {NAV.map((group) => (
              <div key={group.label} className="mb-5">
                <div className="label mb-1.5 px-2 text-faint">{group.label}</div>
                <ul className="space-y-px">
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        onClick={() => setOpen(false)}
                        className={({ isActive }) =>
                          clsx(
                            'group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors pointer-coarse:py-3 pointer-coarse:text-sm',
                            isActive ? 'bg-surface-2 text-foreground' : 'text-muted hover:bg-surface-2/60 hover:text-foreground',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <span
                              aria-hidden
                              className={clsx('absolute inset-y-1.5 left-0 w-0.5 rounded-full', isActive ? 'bg-brand' : 'bg-transparent')}
                            />
                            <item.icon size={15} className={isActive ? 'text-brand' : 'text-faint group-hover:text-muted'} />
                            {item.label}
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="border-t border-border px-5 py-3 text-2xs leading-relaxed text-faint">
            Local data · USD reporting
          </div>
        </aside>

        {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}

        <AssistantInset className="lg:pl-60 print:pl-0">
          <TopBar
            menuButton={
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="-ml-1 rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground pointer-coarse:p-2.5 lg:hidden"
                aria-label={open ? 'Close navigation' : 'Open navigation'}
                aria-expanded={open}
              >
                {open ? <RiCloseLine size={18} /> : <RiMenuLine size={18} />}
              </button>
            }
          />
          <main id="main" className="mx-auto max-w-[1600px] px-4 py-6 md:px-8 md:py-8 print:max-w-none print:p-0">
            <Outlet />
          </main>
        </AssistantInset>
        <AssistantDock />
        <AssistantLauncher />
        <AdminGate />
      </div>
    </AssistantProvider>
  )
}

function Wordmark() {
  return (
    <div className="flex items-baseline gap-2 leading-none">
      <span className="display text-[17px] font-medium text-foreground">Real</span>
      <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.14em] text-muted">Assets Dashboard</span>
    </div>
  )
}
