import { ASSETS, UNIVERSE, assetOfSymbol, type AssetId, type TradingSession } from '@shared/universe'
import { useSettings } from '../store/settings-context'

/** Refresh cadence while the market is open / closed (ms). */
export const REFRESH_OPEN_MS = 30_000
export const REFRESH_CLOSED_MS = 300_000

/**
 * CME Globex (COMEX/NYMEX metals, CME bitcoin futures) trades Sunday 18:00 –
 * Friday 17:00 ET with a daily 17:00–18:00 break.
 */
export function isGlobexOpen(now = new Date()): boolean {
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

/** @deprecated Use `isSessionOpen('globex')`. */
export const isMetalsSessionOpen = isGlobexOpen

/** Is a trading session open right now? `24x7` (spot crypto) never closes. */
export function isSessionOpen(session: TradingSession, now = new Date()): boolean {
  return session === '24x7' ? true : isGlobexOpen(now)
}

/** Session governing a Yahoo symbol: its asset's session, else Globex hours (macro references, equities). */
export function sessionOfSymbol(symbol: string): TradingSession {
  const a = assetOfSymbol(symbol)
  if (!a) return 'globex'
  const u = UNIVERSE[a]
  // A 24/7 display quote (BTC-USD) trades continuously even when its asset's futures follow Globex.
  if (u.displaySpot === symbol) return '24x7'
  // US-listed funds keep exchange hours whatever the underlying does.
  if (u.etfs.includes(symbol) || u.miners === symbol) return 'globex'
  return u.session
}

/** The most permissive session among several (any 24x7 member keeps the group live). */
export function combinedSession(sessions: readonly TradingSession[]): TradingSession {
  return sessions.includes('24x7') ? '24x7' : 'globex'
}

/** Refresh interval for a session at `now`. */
export function refreshInterval(session: TradingSession, now = new Date()): number {
  return isSessionOpen(session, now) ? REFRESH_OPEN_MS : REFRESH_CLOSED_MS
}

export function assetSession(asset: AssetId): TradingSession {
  return (UNIVERSE[asset] ?? UNIVERSE[ASSETS[0]]).session
}

/**
 * TanStack Query `refetchInterval` for live quotes, honouring the top-bar
 * toggle. Session-aware: pass the session of what is being quoted; the default
 * is the session of the asset in focus.
 */
export function useAutoRefresh(session?: TradingSession): number | false {
  const { autoRefresh, asset } = useSettings()
  if (!autoRefresh) return false
  return refreshInterval(session ?? assetSession(asset))
}
