import { UNIVERSE, MONTH_CODES, yahooContractSymbol, type AssetId } from '../../shared/universe.js'
import type { CurveContract, CurveResponse } from '../../shared/markets.js'
import { getDetailedQuotes, type DetailedQuote } from '../services/yahoo-finance.service.js'
import { annualizedCarry, classifyCurve, daysBetween, pickReference, upcomingContractMonths } from './curve-math.js'

export const RATE_SYMBOL = '^IRX'
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** A contract whose last trade is older than this is flagged stale. */
const STALE_MS = 4 * 86_400_000

/**
 * Live futures curve from Yahoo's listed contract months (the asset's main
 * product, active months only, ~24 months out, exchange-specific Yahoo
 * suffix) plus the T-bill rate. An asset without futures gets an empty curve.
 */
export async function buildCurve(asset: AssetId, now = new Date()): Promise<CurveResponse> {
  const spec = UNIVERSE[asset]
  const product = spec.futures[0]
  if (!product) {
    return {
      metal: asset,
      root: null,
      exchange: null,
      unitLabel: spec.unitLabel,
      contracts: [],
      referenceSymbol: null,
      rate: { symbol: RATE_SYMBOL, value: null },
      shape: 'insufficient',
      termCarry: null,
      carryMinusRate: null,
      provenance: { source: `No listed futures for ${spec.label} in the universe`, asOf: null },
    }
  }
  const months = upcomingContractMonths(product.activeMonths, now, 24)
  const symbols = months.map((m) => yahooContractSymbol(product.root, m.month, m.year))
  const quotes = await getDetailedQuotes([...symbols, RATE_SYMBOL])
  const bySymbol = new Map(quotes.map((q) => [q.symbol, q]))
  const today = now.toISOString().slice(0, 10)

  type Draft = Omit<CurveContract, 'isReference' | 'spread' | 'carry'>
  const drafts: Draft[] = []
  months.forEach((m, i) => {
    const q: DetailedQuote | undefined = bySymbol.get(symbols[i])
    if (!q || q.price == null || !(q.price > 0)) return
    if (q.expireDate && q.expireDate < today) return
    const lastTradeMs = q.lastTrade ? Date.parse(q.lastTrade) : NaN
    drafts.push({
      symbol: q.symbol,
      root: product.root,
      month: m.month,
      year: m.year,
      label: `${MONTH_LABELS[m.month - 1]} ${String(m.year).slice(-2)}`,
      expiry: q.expireDate,
      daysToExpiry: q.expireDate ? daysBetween(today, q.expireDate) : null,
      price: q.price,
      change: q.change,
      volume: q.volume,
      openInterest: q.openInterest,
      lastTrade: q.lastTrade,
      stale: !Number.isFinite(lastTradeMs) || now.getTime() - lastTradeMs > STALE_MS,
    })
  })

  const live = drafts.filter((d) => !d.stale)
  const refLocal = pickReference(live)
  const ref = refLocal >= 0 ? live[refLocal] : null

  const contracts: CurveContract[] = drafts.map((d) => {
    const isReference = ref?.symbol === d.symbol
    const days = ref?.daysToExpiry != null && d.daysToExpiry != null ? d.daysToExpiry - ref.daysToExpiry : null
    return {
      ...d,
      isReference,
      spread: ref ? d.price - ref.price : null,
      carry: ref && !isReference && days != null ? annualizedCarry(ref.price, d.price, days) : null,
    }
  })

  // Shape: live contracts from the reference outwards (the delivery month
  // before it is thin and distorted by delivery flows).
  const shapePoints = live
    .filter((d) => ref && d.daysToExpiry != null && ref.daysToExpiry != null && d.daysToExpiry >= ref.daysToExpiry)
    .map((d) => ({ days: d.daysToExpiry as number, price: d.price }))
  const cls = classifyCurve(shapePoints)

  const irx = bySymbol.get(RATE_SYMBOL)
  const rate = irx?.price != null ? irx.price / 100 : null
  const lastTrades = contracts.map((c) => c.lastTrade).filter((t): t is string => !!t).sort()

  return {
    metal: asset,
    root: product.root,
    exchange: product.exchange,
    unitLabel: spec.unitLabel,
    contracts,
    referenceSymbol: ref?.symbol ?? null,
    rate: { symbol: RATE_SYMBOL, value: rate },
    shape: cls.shape,
    termCarry: cls.termCarry,
    carryMinusRate: cls.termCarry != null && rate != null ? cls.termCarry - rate : null,
    provenance: {
      source: `Yahoo Finance · ${product.exchange} ${product.root} listed months (${product.activeMonths.map((m) => MONTH_CODES[m - 1]).join('')}) · ${RATE_SYMBOL}`,
      asOf: lastTrades.length ? lastTrades[lastTrades.length - 1] : null,
      note: 'Quotes may be delayed',
    },
  }
}
