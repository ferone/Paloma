import { UNIVERSE, type AssetId } from '../../shared/universe.js'
import type { EtfRow, EtfsResponse } from '../../shared/markets.js'
import { getBarsSince, getDetailedQuotes, getFundProfile, type DailyBarLite, type FundProfile } from '../services/yahoo-finance.service.js'
import { memo } from './memo.js'
import { modeledNav, periodAnchors, premiumToNav, returnSince, trackingStats, type Bar } from './etf-math.js'

const HOUR = 3_600_000

function returnsOf(bars: Bar[], asOf: string): EtfRow['returns'] {
  const a = periodAnchors(asOf)
  return { m1: returnSince(bars, a.m1), m3: returnSince(bars, a.m3), ytd: returnSince(bars, a.ytd), y1: returnSince(bars, a.y1) }
}

/** Last 1Y (+ a margin for anchors) of daily bars; cached for an hour. */
function yearOfBars(symbol: string): Promise<DailyBarLite[]> {
  return memo(`markets:bars:${symbol}`, HOUR, () => getBarsSince(symbol, new Date(Date.now() - 380 * 86_400_000)))
}

function profile(symbol: string): Promise<FundProfile | null> {
  return memo(`markets:profile:${symbol}`, 6 * HOUR, () => getFundProfile(symbol)).catch(() => null)
}

export async function buildEtfs(asset: AssetId): Promise<EtfsResponse> {
  const spec = UNIVERSE[asset]
  const spotSymbol = spec.spot
  const etfs = spec.miners ? [...spec.etfs, spec.miners] : spec.etfs

  const [quotes, spotBars, ...rest] = await Promise.all([
    getDetailedQuotes([spotSymbol, ...etfs]),
    yearOfBars(spotSymbol),
    ...etfs.map((s) => Promise.all([yearOfBars(s).catch(() => [] as DailyBarLite[]), profile(s)])),
  ])
  const bySymbol = new Map(quotes.map((q) => [q.symbol, q]))
  const spotNow = bySymbol.get(spotSymbol)?.price ?? spotBars.at(-1)?.close ?? null
  const asOf = spotBars.at(-1)?.date ?? new Date().toISOString().slice(0, 10)
  // Compare the trailing year exactly (the fetch includes a margin for anchors).
  const yearStart = periodAnchors(asOf).y1
  const trim = (bars: Bar[]) => bars.filter((b) => b.date >= yearStart)

  const rows: EtfRow[] = []
  etfs.forEach((symbol, i) => {
    const q = bySymbol.get(symbol)
    if (!q || q.price == null) return
    const [bars, prof] = rest[i] as [DailyBarLite[], FundProfile | null]
    const isMiners = symbol === spec.miners
    let nav: number | null = null
    let method: EtfRow['premiumMethod'] = 'none'
    if (!isMiners) {
      if (prof?.navPrice) {
        nav = prof.navPrice
        method = 'nav'
      } else {
        nav = modeledNav(trim(bars), trim(spotBars), spotNow)
        method = nav != null ? 'modeled' : 'none'
      }
    }
    const t = trackingStats(trim(bars), trim(spotBars))
    rows.push({
      symbol,
      name: q.shortName,
      kind: isMiners ? 'miners' : 'physical',
      price: q.price,
      changePercent: q.changePercent != null ? q.changePercent / 100 : null,
      volume: q.volume,
      dollarVolume: q.volume != null ? q.volume * q.price : null,
      aum: prof?.totalAssets ?? null,
      expenseRatio: prof?.expenseRatio ?? null,
      nav,
      // Last price vs the latest published NAV (struck at the prior business
      // day's reference price, LBMA PM for metals), so it also carries the move since then.
      premium: premiumToNav(q.price, nav),
      premiumMethod: method,
      returns: returnsOf(bars, asOf),
      trackingDiff1y: isMiners ? null : t.diff,
      trackingError1y: isMiners ? null : t.error,
      correlation1y: t.correlation,
    })
  })

  const lastTrades = quotes.map((q) => q.lastTrade).filter((t): t is string => !!t).sort()
  return {
    metal: asset,
    spotSymbol,
    spotReturns: returnsOf(spotBars, asOf),
    rows,
    provenance: {
      source: `Yahoo Finance quotes, NAV (summaryDetail) and daily closes · spot proxy ${spotSymbol}`,
      asOf: lastTrades.length ? lastTrades[lastTrades.length - 1] : asOf,
      modeled: rows.some((r) => r.premiumMethod === 'modeled'),
      note:
        spec.assetClass === 'crypto'
          ? 'Premium = last price vs latest published NAV (reference rate, prior business day)'
          : 'Premium = last price vs latest published NAV (LBMA PM, prior business day)',
    },
  }
}
