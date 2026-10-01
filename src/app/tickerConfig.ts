import { useSyncExternalStore } from 'react'
import { ASSETS, RELATIVE_VALUE_PAIRS, UNIVERSE, type AssetId, type RelativeValuePair } from '@shared/universe'

// Configurable top-bar ticker strip. Items are keyed "asset:<AssetId>" or
// "pair:<RelativeValuePair.id>".
//
// Two modes:
// - default (nothing saved): the asset in focus, gold and bitcoin (deduped)
//   and one ratio (the focused asset's natural pair, else gold/silver) are
//   shown; every other item sits behind the "+N" overflow menu.
// - custom: the user's chosen list, shown in catalog order, nothing hidden.
//
// Stored in localStorage as a JSON array of keys (custom) or absent (default).
// The pre-2026-10 strip stored the full catalog when the user had reset it;
// that exact list migrates to the default mode. PURE except for the storage
// helpers and the hook at the bottom.

export type TickerKey = `asset:${string}` | `pair:${string}`

export type TickerItem =
  | { key: TickerKey; kind: 'asset'; asset: AssetId; label: string; title: string }
  | { key: TickerKey; kind: 'pair'; pair: RelativeValuePair; label: string; title: string }

export type TickerConfig = { mode: 'default' } | { mode: 'custom'; keys: TickerKey[] }

export const TICKER_STORAGE_KEY = 'gid.ticker'
const CHANGE_EVENT = 'gid.ticker-change'

/** Every item the strip can show, in catalog order: each asset, then each relative-value ratio. */
export function tickerCatalog(): TickerItem[] {
  return [
    ...ASSETS.map((a): TickerItem => ({ key: `asset:${a}`, kind: 'asset', asset: a, label: UNIVERSE[a].short, title: UNIVERSE[a].label })),
    ...RELATIVE_VALUE_PAIRS.map(
      (p): TickerItem => ({
        key: `pair:${p.id}`,
        kind: 'pair',
        pair: p,
        label: `${UNIVERSE[p.numerator].short}/${UNIVERSE[p.denominator].short}`,
        title: `${p.label} ratio`,
      }),
    ),
  ]
}

/** Every key, in catalog order. */
export function allTickerKeys(): TickerKey[] {
  return tickerCatalog().map((i) => i.key)
}

/** The focused asset's natural ratio: the first relative-value pair it belongs to, else gold/silver. */
export function naturalPair(focus: AssetId): RelativeValuePair {
  return RELATIVE_VALUE_PAIRS.find((p) => p.numerator === focus || p.denominator === focus) ?? RELATIVE_VALUE_PAIRS.find((p) => p.id === 'GS') ?? RELATIVE_VALUE_PAIRS[0]
}

/** Keys shown up front by default: focus asset, gold, bitcoin (deduped, in that order), then the natural ratio. */
export function defaultTickerKeys(focus: AssetId): TickerKey[] {
  const known = new Set<string>(allTickerKeys())
  const assets = [...new Set<AssetId>([focus, 'gold', 'btc'])].map((a): TickerKey => `asset:${a}`)
  const pair = RELATIVE_VALUE_PAIRS.length ? [`pair:${naturalPair(focus).id}` as TickerKey] : []
  return [...assets, ...pair].filter((k) => known.has(k))
}

function isFullCatalog(keys: readonly string[]): boolean {
  const all = allTickerKeys()
  return keys.length === all.length && all.every((k, i) => keys[i] === k)
}

/**
 * Parse a stored config. Absent, malformed or legacy-default (the full
 * catalog) means default mode. Otherwise a custom list: unknown keys (an asset
 * removed from the universe) and duplicates are dropped; an empty array is a
 * valid choice (strip hidden); a list of only unknown keys falls back to default.
 */
export function parseTickerConfig(raw: string | null | undefined): TickerConfig {
  if (raw == null || raw === '') return { mode: 'default' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { mode: 'default' }
  }
  if (!Array.isArray(parsed)) return { mode: 'default' }
  if (isFullCatalog(parsed)) return { mode: 'default' }
  const known = new Set<string>(allTickerKeys())
  const keys: TickerKey[] = []
  for (const k of parsed) {
    if (typeof k === 'string' && known.has(k) && !keys.includes(k as TickerKey)) keys.push(k as TickerKey)
  }
  if (keys.length === 0 && parsed.length > 0) return { mode: 'default' }
  return { mode: 'custom', keys }
}

/** Serialized form, or null for the default mode (nothing stored). */
export function serializeTickerConfig(cfg: TickerConfig): string | null {
  return cfg.mode === 'default' ? null : JSON.stringify(cfg.keys)
}

/** Items in catalog order. */
export function tickerItems(keys: readonly TickerKey[]): TickerItem[] {
  const on = new Set(keys)
  return tickerCatalog().filter((i) => on.has(i.key))
}

/** What the strip shows up front and what goes behind the overflow button. */
export function resolveTicker(cfg: TickerConfig, focus: AssetId): { visible: TickerItem[]; overflow: TickerItem[] } {
  if (cfg.mode === 'custom') return { visible: tickerItems(cfg.keys), overflow: [] }
  const byKey = new Map(tickerCatalog().map((i) => [i.key, i]))
  const front = defaultTickerKeys(focus)
  const visible = front.map((k) => byKey.get(k)!).filter(Boolean)
  const shown = new Set(front)
  return { visible, overflow: tickerCatalog().filter((i) => !shown.has(i.key)) }
}

/** Keys currently shown up front (what a checkbox list should reflect). */
export function selectedKeys(cfg: TickerConfig, focus: AssetId): TickerKey[] {
  return cfg.mode === 'custom' ? cfg.keys : defaultTickerKeys(focus)
}

/** Toggle one key, starting from what is shown; the result is a custom list in catalog order. */
export function toggleTickerKey(cfg: TickerConfig, focus: AssetId, key: TickerKey): TickerConfig {
  const on = new Set(selectedKeys(cfg, focus))
  if (on.has(key)) on.delete(key)
  else on.add(key)
  return { mode: 'custom', keys: allTickerKeys().filter((k) => on.has(k)) }
}

/** Yahoo symbols the items need: `displaySpot ?? spot` per asset, both spots per ratio. */
export function tickerSymbols(items: readonly TickerItem[]): string[] {
  const s = new Set<string>()
  for (const i of items) {
    if (i.kind === 'asset') s.add(UNIVERSE[i.asset].displaySpot ?? UNIVERSE[i.asset].spot)
    else {
      s.add(UNIVERSE[i.pair.numerator].spot)
      s.add(UNIVERSE[i.pair.denominator].spot)
    }
  }
  return [...s]
}

// ── Storage (per browser) ────────────────────────────────────────────────────

function readRaw(): string | null {
  try {
    return localStorage.getItem(TICKER_STORAGE_KEY)
  } catch {
    return null
  }
}

let memoryRaw: string | null | undefined // used when storage is unavailable

export function readTickerConfig(): TickerConfig {
  return parseTickerConfig(memoryRaw !== undefined ? memoryRaw : readRaw())
}

export function writeTickerConfig(cfg: TickerConfig): void {
  const raw = serializeTickerConfig(cfg)
  try {
    if (raw == null) localStorage.removeItem(TICKER_STORAGE_KEY)
    else localStorage.setItem(TICKER_STORAGE_KEY, raw)
    memoryRaw = undefined
  } catch {
    memoryRaw = raw // non-persistent is fine
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === TICKER_STORAGE_KEY) onChange()
  }
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

const snapshot = () => (memoryRaw !== undefined ? memoryRaw : readRaw())

/** The ticker config, shared live by the top-bar strip and Settings (and across tabs). */
export function useTickerConfig(): [TickerConfig, (cfg: TickerConfig) => void] {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null)
  return [parseTickerConfig(raw), writeTickerConfig]
}
