import { useSettings } from '../store/settings-context'
import { getRefreshInterval } from '../lib/date-utils'

export function useAutoRefresh(): number | false {
  const { autoRefresh } = useSettings()
  return getRefreshInterval(autoRefresh)
}
