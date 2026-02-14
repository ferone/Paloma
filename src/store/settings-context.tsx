import { createContext, useContext, useState, type ReactNode } from 'react'

interface SettingsContextType {
  autoRefresh: boolean
  toggleAutoRefresh: () => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [autoRefresh, setAutoRefresh] = useState(true)

  return (
    <SettingsContext.Provider
      value={{
        autoRefresh,
        toggleAutoRefresh: () => setAutoRefresh((p) => !p),
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
