import { UNIVERSE, yahooContractSymbol, type Metal } from '../../shared/universe.js'
import { upcomingContractMonths } from './curve-math.js'
import { memo } from './memo.js'
import type {
  InstrumentLiquidity,
  LiquidityHistoryResponse,
  LiquidityHistoryRow,
  LiquiditySnapshot,
  LiquiditySpike,
  ModeledSplit,
} from '../../shared/markets.js'
import { getBarsSince, getDetailedQuotes } from '../services/yahoo-finance.service.js'
import { LIQUIDITY_INSTRUMENTS, REGION_DATA, SOURCE_BREAKDOWN, SOURCE_KEYS } from '../data/gold-constants.js'
import { MARKET_EVENTS } from '../data/market-events.js'

const SPLIT_SOURCE = 'Source split modeled from World Gold Council demand shares (fixed percentages)'

/** Modeled World Gold Council-style splits. Gold only: silver has no equivalent dataset here. */
export function modeledSplit(metal: Metal): ModeledSplit | null {
  if (metal !== 'gold') return null
  return {
    sources: SOURCE_BREAKDOWN.map((s, i) => ({ key: SOURCE_KEYS[i], label: s.name, share: s.percent / 100 })),
    regions: REGION_DATA.map((r) => ({
      region: r.region,
      share: r.percent / 100,
      countries: r.countries.map((c) => ({
        country: c.country,
        share: c.percent / 100,
        breakdown: c.breakdown.map((b) => ({ type: b.type, share: b.percent / 100 })),
      })),
    })),
    provenance: { source: SPLIT_SOURCE, asOf: null, modeled: true, note: 'Static shares, not observed flows' },
  }
}

function dollarVolume(def: (typeof LIQUIDITY_INSTRUMENTS)['gold'][number], volume: number, price: number): number {
  return def.kind === 'future' ? volume * (def.ozPerContract ?? 1) * price : volume * price
}

/**
 * Daily futures volume summed across the listed active contract months (the
 * continuous `=F` series only carries one month and, for silver, the wrong one).
 * Months that expired inside the window are not included.
 */
async function listedFuturesVolume(metal: Metal, sessions = 30): Promise<{ date: string; volume: number }[]> {
  const product = UNIVERSE[metal].futures[0]
  const since = new Date(Date.now() - (sessions + 20) * 86_400_000)
  const symbols = upcomingContractMonths(product.activeMonths, new Date(), 24).map((m) =>
    yahooContractSymbol(product.root, m.month, m.year),
  )
  const results = await Promise.allSettled(
    symbols.map((s) => memo(`markets:bars45:${s}`, 30 * 60_000, () => getBarsSince(s, since))),
  )
  const byDate = new Map<string, number>()
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const b of r.value) byDate.set(b.date, (byDate.get(b.date) ?? 0) + b.volume)
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-sessions)
    .map(([date, volume]) => ({ date, volume }))
}

export async function liquiditySnapshot(metal: Metal): Promise<LiquiditySnapshot> {
  const defs = LIQUIDITY_INSTRUMENTS[metal]
  const [quotes, futVolume] = await Promise.all([
    getDetailedQuotes(defs.map((d) => d.symbol)),
    listedFuturesVolume(metal).catch(() => []),
  ])
  const bySymbol = new Map(quotes.map((q) => [q.symbol, q]))

  const instruments: InstrumentLiquidity[] = []
  for (const def of defs) {
    const q = bySymbol.get(def.symbol)
    if (!q || q.price == null) continue
    const volume = q.volume ?? 0
    instruments.push({
      symbol: def.symbol,
      name: def.name,
      kind: def.kind,
      price: q.price,
      volume,
      dollarVolume: dollarVolume(def, volume, q.price),
    })
  }
  const lastTrades = quotes.map((q) => q.lastTrade).filter((t): t is string => !!t).sort()

  return {
    metal,
    totalDollarVolume: instruments.reduce((s, i) => s + i.dollarVolume, 0),
    instruments: instruments.sort((a, b) => b.dollarVolume - a.dollarVolume),
    futuresVolume: futVolume,
    futuresSymbol: UNIVERSE[metal].futures[0].root,
    split: modeledSplit(metal),
    provenance: {
      source: 'Yahoo Finance session volumes (front future + physically backed ETFs)',
      asOf: lastTrades.length ? lastTrades[lastTrades.length - 1] : null,
      note: 'Futures dollar volume = contracts × oz/contract × price',
    },
  }
}

const RANGE_DAYS: Record<string, number> = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366, '5Y': 5 * 366 }

function rangeSpec(range: string): { from: Date; interval: '1d' | '1wk' | '1mo' } {
  if (range === 'ALL') return { from: new Date('2005-01-01T00:00:00Z'), interval: '1mo' }
  const days = RANGE_DAYS[range] ?? RANGE_DAYS['1Y']
  return { from: new Date(Date.now() - days * 86_400_000), interval: range === '5Y' ? '1wk' : '1d' }
}

/** Top-N volume spikes (z > 1.2) with the nearest catalogued market event within 3 days. */
export function detectSpikes(history: { date: string; total: number }[], count = 6): LiquiditySpike[] {
  if (history.length < 10) return []
  const vals = history.map((d) => d.total)
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length
  const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length)
  if (std === 0) return []
  // Strongest first; skip bars within 5 days of a stronger spike so one
  // multi-day episode doesn't take every slot.
  const picked: { date: string; total: number; z: number }[] = []
  const candidates = history
    .map((d) => ({ date: d.date, total: d.total, z: (d.total - mean) / std }))
    .filter((d) => d.z > 1.2)
    .sort((a, b) => b.z - a.z)
  for (const c of candidates) {
    if (picked.length >= count) break
    const t = Date.parse(`${c.date}T00:00:00Z`)
    if (picked.some((p) => Math.abs(Date.parse(`${p.date}T00:00:00Z`) - t) <= 5 * 86_400_000)) continue
    picked.push(c)
  }
  return picked
    .map((s) => {
      const t = Date.parse(`${s.date}T00:00:00Z`)
      let best: (typeof MARKET_EVENTS)[number] | null = null
      let bestDist = Infinity
      for (const e of MARKET_EVENTS) {
        const dist = Math.abs(t - Date.parse(`${e.date}T00:00:00Z`)) / 86_400_000
        if (dist <= 3 && dist < bestDist) {
          best = e
          bestDist = dist
        }
      }
      return { ...s, title: best?.title ?? null, description: best?.description ?? null }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function liquidityHistory(metal: Metal, range: string): Promise<LiquidityHistoryResponse> {
  const excluded = LIQUIDITY_INSTRUMENTS[metal].filter((d) => d.historyReliable === false)
  const defs = LIQUIDITY_INSTRUMENTS[metal].filter((d) => d.historyReliable !== false)
  const { from, interval } = rangeSpec(range)
  const results = await Promise.allSettled(defs.map((d) => getBarsSince(d.symbol, from, interval)))

  const byDate = new Map<string, LiquidityHistoryRow>()
  const included: { symbol: string; name: string }[] = []
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled' || r.value.length === 0) return
    const def = defs[i]
    included.push({ symbol: def.symbol, name: def.name })
    for (const bar of r.value) {
      const row = byDate.get(bar.date) ?? { date: bar.date, total: 0, bySymbol: {} }
      const dv = dollarVolume(def, bar.volume, bar.close)
      row.bySymbol[def.symbol] = (row.bySymbol[def.symbol] ?? 0) + dv
      row.total += dv
      byDate.set(bar.date, row)
    }
  })
  const history = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const total = history.reduce((s, d) => s + d.total, 0)

  return {
    metal,
    range,
    interval,
    symbols: included,
    history,
    summary: { total, avgDaily: history.length ? total / history.length : 0, sessions: history.length },
    spikes: detectSpikes(history),
    split: modeledSplit(metal),
    provenance: {
      source: `Yahoo Finance ${interval === '1d' ? 'daily' : interval === '1wk' ? 'weekly' : 'monthly'} volumes`,
      asOf: history.length ? history[history.length - 1].date : null,
      note: [
        excluded.length
          ? `${excluded.map((d) => d.symbol).join(', ')} excluded: Yahoo's continuous-contract volume history is unreliable`
          : null,
        'Spikes matched to the curated gold-market event list (±3 days)',
      ]
        .filter(Boolean)
        .join(' · '),
    },
  }
}
