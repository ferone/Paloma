import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Metal } from '@shared/universe'

interface SettingsContextType {
  autoRefresh: boolean
  toggleAutoRefresh: () => void
  /** Metal in focus for metal-parameterized views (Quant Lab, Markets, ML). */
  metal: Metal
  setMetal: (m: Metal) => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)
const METAL_KEY = 'gid.metal'

function readMetal(): Metal {
  try {
    return localStorage.getItem(METAL_KEY) === 'silver' ? 'silver' : 'gold'
  } catch {
    return 'gold'
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [metal, setMetal] = useState<Metal>(readMetal)

  useEffect(() => {
    try {
      localStorage.setItem(METAL_KEY, metal)
    } catch {
      // non-persistent is fine
    }
  }, [metal])

  return (
    <SettingsContext.Provider
      value={{
        autoRefresh,
        toggleAutoRefresh: () => setAutoRefresh((p) => !p),
        metal,
        setMetal,
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
