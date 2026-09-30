import { useSettings } from '../store/settings-context'

/**
 * COMEX metals trade Sunday 18:00 – Friday 17:00 ET with a daily 17:00–18:00
 * break. Refresh fast while that session is open, slowly otherwise.
 */
export function isMetalsSessionOpen(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)
  const day = parts.find((p) => p.type === 'weekday')?.value
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  if (day === 'Sat') return false
  if (day === 'Sun') return hour >= 18
  if (day === 'Fri') return hour < 17
  return hour !== 17
}

/** TanStack Query `refetchInterval` for live quotes, honouring the top-bar toggle. */
export function useAutoRefresh(): number | false {
  const { autoRefresh } = useSettings()
  if (!autoRefresh) return false
  return isMetalsSessionOpen() ? 30_000 : 300_000
}
