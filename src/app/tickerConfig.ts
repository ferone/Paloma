import { ASSETS, RELATIVE_VALUE_PAIRS, UNIVERSE, type AssetId, type RelativeValuePair } from '@shared/universe'

// Configurable top-bar ticker strip. Items are keyed "asset:<AssetId>" or
// "pair:<RelativeValuePair.id>"; the chosen, ordered list is persisted in
// localStorage. PURE except for the storage helpers at the bottom.

export type TickerKey = `asset:${string}` | `pair:${string}`

export type TickerItem =
  | { key: TickerKey; kind: 'asset'; asset: AssetId; label: string; title: string }
  | { key: TickerKey; kind: 'pair'; pair: RelativeValuePair; label: string; title: string }

export const TICKER_STORAGE_KEY = 'gid.ticker'

/** Every item the strip can show, in default order: each asset, then each relative-value ratio. */
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

export function defaultTickerKeys(): TickerKey[] {
  return tickerCatalog().map((i) => i.key)
}

/**
 * Parse a stored config: a JSON array of keys. Unknown keys (an asset removed
 * from the universe) and duplicates are dropped; anything malformed yields the
 * default. An empty array is a valid choice (strip hidden).
 */
export function parseTickerConfig(raw: string | null | undefined): TickerKey[] {
  if (raw == null) return defaultTickerKeys()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return defaultTickerKeys()
  }
  if (!Array.isArray(parsed)) return defaultTickerKeys()
  const known = new Set<string>(defaultTickerKeys())
  const out: TickerKey[] = []
  for (const k of parsed) {
    if (typeof k === 'string' && known.has(k) && !out.includes(k as TickerKey)) out.push(k as TickerKey)
  }
  // Every stored key was unknown (e.g. all assets renamed): fall back rather than hide the strip.
  return out.length === 0 && parsed.length > 0 ? defaultTickerKeys() : out
}

export function serializeTickerConfig(keys: readonly TickerKey[]): string {
  return JSON.stringify(keys)
}

/** Selected items in catalog order. */
export function tickerItems(keys: readonly TickerKey[]): TickerItem[] {
  const on = new Set(keys)
  return tickerCatalog().filter((i) => on.has(i.key))
}

/** Toggle one key, keeping catalog order. */
export function toggleTickerKey(keys: readonly TickerKey[], key: TickerKey): TickerKey[] {
  const on = new Set(keys)
  if (on.has(key)) on.delete(key)
  else on.add(key)
  return defaultTickerKeys().filter((k) => on.has(k))
}

/** Yahoo symbols the selected items need: `displaySpot ?? spot` per asset, both spots per ratio. */
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

export function readTickerConfig(): TickerKey[] {
  try {
    return parseTickerConfig(localStorage.getItem(TICKER_STORAGE_KEY))
  } catch {
    return defaultTickerKeys()
  }
}

export function writeTickerConfig(keys: readonly TickerKey[]): void {
  try {
    localStorage.setItem(TICKER_STORAGE_KEY, serializeTickerConfig(keys))
  } catch {
    // non-persistent is fine
  }
}
