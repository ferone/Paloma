import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { parseAssetId, type AssetId, type Metal } from '@shared/universe'

interface SettingsContextType {
  autoRefresh: boolean
  toggleAutoRefresh: () => void
  /** Asset in focus for asset-parameterized views (Markets, Quant Lab, Macro, Intelligence). */
  asset: AssetId
  setAsset: (a: AssetId) => void
  /** @deprecated Use `asset`. Same value, kept while pages migrate. */
  metal: Metal
  /** @deprecated Use `setAsset`. */
  setMetal: (m: Metal) => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)
const ASSET_KEY = 'gid.asset'
const LEGACY_METAL_KEY = 'gid.metal'

function readAsset(): AssetId {
  try {
    return parseAssetId(localStorage.getItem(ASSET_KEY) ?? localStorage.getItem(LEGACY_METAL_KEY))
  } catch {
    return parseAssetId(null)
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [asset, setAsset] = useState<AssetId>(readAsset)

  useEffect(() => {
    try {
      localStorage.setItem(ASSET_KEY, asset)
      localStorage.removeItem(LEGACY_METAL_KEY)
    } catch {
      // non-persistent is fine
    }
  }, [asset])

  return (
    <SettingsContext.Provider
      value={{
        autoRefresh,
        toggleAutoRefresh: () => setAutoRefresh((p) => !p),
        asset,
        setAsset,
        metal: asset,
        setMetal: setAsset,
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
