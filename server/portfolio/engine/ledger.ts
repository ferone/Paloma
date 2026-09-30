// Pure fund-accounting engine: replays the ledger day by day, values every
// position at that day's close, unitizes capital flows and tracks per-holding
// P&L so performance can be attributed. No I/O: prices come in via PriceBook.
import type { Metal } from '../../../shared/universe.js'
import type { Instrument, Sleeve, Transaction, UnitEntry } from '../../../shared/portfolio.js'
import { sleeveOfKind } from '../../../shared/portfolio.js'
import { applyFill, netQty, sign, transferLots, type Lot } from './lots.js'

export interface PriceBook {
  /** Last close on or before `date`, with the date it was observed. */
  close(symbol: string, date: string): { price: number; date: string } | null
}

export interface EngineSettings {
  baseNavPerUnit: number
  physicalHaircut: number
}

/** Key used for fund-level cash P&L (interest income, fund expenses). */
export const CASH_KEY = 'USD'

export interface EnginePoint {
  date: string
  nav: number
  units: number
  navPerUnit: number | null
  /** navPerUnit / previous navPerUnit − 1 (first valued day vs base). */
  dailyReturn: number | null
  cash: number
  grossExposure: number
  netFlow: number
  /** NAV contribution per non-cash instrument. */
  values: Record<string, number>
  bySleeve: Partial<Record<Sleeve, number>>
  byMetal: Partial<Record<Metal | 'cash' | 'other', number>>
  /** Daily P&L per instrument (plus CASH_KEY). */
  pnl: Record<string, number>
  /** Cumulative P&L since inception per instrument (plus CASH_KEY). */
  cumPnl: Record<string, number>
  /**
   * Cumulative growth-weighted contribution per instrument (plus CASH_KEY):
   * Σ_t (P&L_t / NAV_{t−1}) × NAV/unit_{t−1} / base. For a period starting
   * after point s, (cumContrib_end − cumContrib_s) × base / NAV/unit_s sums
   * exactly to the period's TWR across instruments (no linking residual).
   */
  cumContrib: Record<string, number>
}

export interface PositionState {
  instrumentId: string
  lots: Lot[]
  realized: number
  income: number
  expenses: number
  /** Last trade price, used as a fallback mark. */
  lastTradePrice: number | null
  lastTradeDate: string | null
}

export interface Mark {
  price: number
  date: string
  fallback: boolean
}

export interface EngineRun {
  points: EnginePoint[]
  units: UnitEntry[]
  positions: Map<string, PositionState>
  cashByAccount: Map<number, number>
  /** Marks used on the last valuation date. */
  marks: Map<string, Mark>
  warnings: string[]
}

const EPS = 1e-9

export function sortTransactions(txns: Transaction[]): Transaction[] {
  return [...txns].sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : a.id - b.id))
}

/** Multiplier from price units to dollars. */
export function multiplierOf(inst: Instrument): number {
  return inst.kind === 'future' ? (inst.ozPerContract ?? 1) : 1
}

/**
 * Value a position at `mark`: market value (futures: open variation P&L),
 * gross notional and troy-oz exposure.
 */
export function valuePosition(inst: Instrument, lots: Lot[], mark: number, haircut: number) {
  const qty = netQty(lots)
  const mult = multiplierOf(inst)
  if (inst.kind === 'future') {
    const value = lots.reduce((s, l) => s + l.qty * mult * (mark - l.unitCost), 0)
    return { value, notional: Math.abs(qty) * mult * mark, ounces: qty * mult }
  }
  if (inst.kind === 'physical') {
    return { value: qty * mark * (1 - haircut), notional: Math.abs(qty) * mark, ounces: qty }
  }
  return { value: qty * mark, notional: Math.abs(qty) * mark, ounces: null as number | null }
}

export function runLedger(
  transactions: Transaction[],
  instruments: Map<string, Instrument>,
  prices: PriceBook,
  dates: string[],
  settings: EngineSettings,
): EngineRun {
  const txns = sortTransactions(transactions)
  const warnings = new Set<string>()
  const positions = new Map<string, PositionState>()
  const cashByAccount = new Map<number, number>()
  const points: EnginePoint[] = []
  const unitEntries: UnitEntry[] = []
  const cumPnl: Record<string, number> = {}
  const cumContrib: Record<string, number> = {}
  let marks = new Map<string, Mark>()

  if (txns.length === 0) return { points, units: unitEntries, positions, cashByAccount, marks, warnings: [] }

  const first = txns[0].tradeDate
  const allDates = [...new Set([...dates.filter((d) => d >= first), ...txns.map((t) => t.tradeDate)])].sort()

  const pos = (id: string): PositionState => {
    let p = positions.get(id)
    if (!p) {
      p = { instrumentId: id, lots: [], realized: 0, income: 0, expenses: 0, lastTradePrice: null, lastTradeDate: null }
      positions.set(id, p)
    }
    return p
  }
  const addCash = (account: number, amount: number) => cashByAccount.set(account, (cashByAccount.get(account) ?? 0) + amount)

  let units = 0
  let prevNav = 0
  let prevNpu: number | null = null
  let prevValues: Record<string, number> = {}
  let ti = 0

  for (const date of allDates) {
    const cf: Record<string, number> = {}
    const addCf = (id: string, amt: number) => (cf[id] = (cf[id] ?? 0) + amt)
    let cashPnl = 0
    const flows: { txn: Transaction; amount: number }[] = []

    for (; ti < txns.length && txns[ti].tradeDate === date; ti++) {
      const t = txns[ti]
      const inst = instruments.get(t.instrumentId)
      if (!inst) {
        warnings.add(`Transaction #${t.id} references unknown instrument ${t.instrumentId}; ignored.`)
        continue
      }
      const isCash = inst.kind === 'cash'
      const gross = t.quantity * t.price
      const p = isCash ? null : pos(inst.id)
      if (p && t.price > 0 && ['buy', 'sell', 'futures_open', 'futures_close', 'deposit', 'withdrawal'].includes(t.type)) {
        p.lastTradePrice = t.price
        p.lastTradeDate = t.tradeDate
      }

      switch (t.type) {
        case 'buy':
        case 'sell': {
          if (!p) break
          const q = t.type === 'buy' ? t.quantity : -t.quantity
          const held = netQty(p.lots)
          const r = applyFill(p.lots, q, t.price, { fees: t.fees, date, txnId: t.id, accountId: t.accountId })
          if (t.type === 'sell' && held < t.quantity - EPS)
            warnings.add(`${inst.id}: sell of ${t.quantity} on ${date} exceeds the ${Math.max(0, held)} held; the excess is carried as a short lot.`)
          if (r.crossedAccounts) warnings.add(`${inst.id}: ${t.type} on ${date} consumed lots held in another account.`)
          p.realized += r.realized
          const c = t.type === 'buy' ? -(gross + t.fees) : gross - t.fees
          addCash(t.accountId, c)
          addCf(inst.id, c)
          break
        }
        case 'futures_open':
        case 'futures_close': {
          if (!p) break
          let q = t.quantity
          if (t.type === 'futures_close') {
            const s = sign(netQty(p.lots))
            if (s === 0) {
              warnings.add(`${inst.id}: futures close on ${date} with no open position; ignored.`)
              q = 0
            } else {
              const open = Math.abs(netQty(p.lots))
              if (t.quantity > open + EPS) warnings.add(`${inst.id}: close of ${t.quantity} contracts on ${date} exceeds the ${open} open.`)
              q = -s * t.quantity
            }
          }
          const r = applyFill(p.lots, q, t.price, {
            multiplier: multiplierOf(inst),
            feesInCost: false,
            date,
            txnId: t.id,
            accountId: t.accountId,
          })
          p.realized += r.realized
          p.expenses += t.fees
          const c = r.realized - t.fees
          addCash(t.accountId, c)
          addCf(inst.id, c)
          break
        }
        case 'subscription':
        case 'redemption':
        case 'deposit':
        case 'withdrawal': {
          const inflow = t.type === 'subscription' || t.type === 'deposit'
          const value = gross
          if (isCash) {
            addCash(t.accountId, inflow ? value : -value)
          } else if (p) {
            if (inst.kind === 'future') {
              warnings.add(`Transaction #${t.id}: in-kind ${t.type} of futures is not supported; ignored.`)
              break
            }
            const r = applyFill(p.lots, inflow ? t.quantity : -t.quantity, t.price, { fees: 0, date, txnId: t.id, accountId: t.accountId })
            p.realized += r.realized
            addCf(inst.id, inflow ? -value : value)
          }
          if (t.fees) {
            addCash(t.accountId, -t.fees)
            cashPnl -= t.fees
          }
          flows.push({ txn: t, amount: inflow ? value : -value })
          break
        }
        case 'fee':
        case 'storage_fee': {
          const amt = gross + t.fees
          addCash(t.accountId, -amt)
          if (p) {
            p.expenses += amt
            addCf(inst.id, -amt)
          } else cashPnl -= amt
          break
        }
        case 'dividend':
        case 'interest': {
          const amt = gross - t.fees
          addCash(t.accountId, amt)
          if (p) {
            p.income += amt
            addCf(inst.id, amt)
          } else cashPnl += amt
          break
        }
        case 'transfer': {
          if (!t.counterAccountId) break
          if (isCash) {
            addCash(t.accountId, -gross)
            addCash(t.counterAccountId, gross)
          } else if (p) {
            const moved = transferLots(p.lots, t.quantity, t.accountId, t.counterAccountId)
            if (moved < t.quantity - EPS) warnings.add(`${inst.id}: transfer on ${date} moved ${moved} of ${t.quantity} (insufficient lots in source account).`)
          }
          if (t.fees) {
            addCash(t.accountId, -t.fees)
            if (p) {
              p.expenses += t.fees
              addCf(inst.id, -t.fees)
            } else cashPnl -= t.fees
          }
          break
        }
      }
    }

    // Value every open position at today's close.
    marks = new Map()
    const values: Record<string, number> = {}
    const bySleeve: Partial<Record<Sleeve, number>> = {}
    const byMetal: Partial<Record<Metal | 'cash' | 'other', number>> = {}
    let gross = 0
    for (const [id, p] of positions) {
      const inst = instruments.get(id)!
      if (p.lots.length === 0) {
        if (prevValues[id] !== undefined) values[id] = 0
        continue
      }
      const m = markFor(inst, p, date, prices)
      if (!m) {
        warnings.add(`${id}: no price available on ${date}; valued at zero.`)
        continue
      }
      marks.set(id, m)
      const v = valuePosition(inst, p.lots, m.price, settings.physicalHaircut)
      values[id] = v.value
      gross += v.notional
      const sl = sleeveOfKind(inst.kind)
      bySleeve[sl] = (bySleeve[sl] ?? 0) + v.value
      const mk = inst.metal ?? 'other'
      byMetal[mk] = (byMetal[mk] ?? 0) + v.value
    }
    const cash = [...cashByAccount.values()].reduce((s, x) => s + x, 0)
    bySleeve.cash = cash
    byMetal.cash = cash
    const nav = Object.values(values).reduce((s, x) => s + x, 0) + cash

    // Unitize today's flows at the pre-flow NAV/unit.
    const netFlow = flows.reduce((s, f) => s + f.amount, 0)
    const navEx = nav - netFlow
    const npuPre = units > EPS ? navEx / units : settings.baseNavPerUnit
    if (units <= EPS && Math.abs(navEx) > 1 && flows.length > 0 && points.length > 0)
      warnings.add(`${date}: flows unitized at base NAV/unit while the fund held ${navEx.toFixed(2)} with no units outstanding.`)
    for (const f of flows) {
      const du = npuPre > EPS ? f.amount / npuPre : 0
      units += du
      if (units < EPS && units > -1e-6) units = 0
      unitEntries.push({
        date,
        txnId: f.txn.id,
        type: f.txn.type as UnitEntry['type'],
        amount: f.amount,
        navPerUnit: npuPre,
        units: du,
        unitsOutstanding: units,
      })
    }
    if (units < -1e-6) warnings.add(`${date}: redemptions exceed units outstanding.`)
    const navPerUnit = units > EPS ? nav / units : null

    // Daily P&L and contribution per instrument.
    const pnl: Record<string, number> = {}
    const ids = new Set([...Object.keys(values), ...Object.keys(prevValues), ...Object.keys(cf)])
    const denom = prevNav > EPS ? prevNav : netFlow > EPS ? netFlow : 0
    for (const id of ids) {
      const d = (values[id] ?? 0) - (prevValues[id] ?? 0) + (cf[id] ?? 0)
      if (Math.abs(d) < 1e-12) continue
      pnl[id] = d
    }
    if (cashPnl) pnl[CASH_KEY] = cashPnl
    for (const [id, d] of Object.entries(pnl)) {
      cumPnl[id] = (cumPnl[id] ?? 0) + d
      const growth = (prevNpu ?? settings.baseNavPerUnit) / settings.baseNavPerUnit
      if (denom > 0) cumContrib[id] = (cumContrib[id] ?? 0) + (d / denom) * growth
    }

    const base = prevNpu ?? (navPerUnit != null ? settings.baseNavPerUnit : null)
    points.push({
      date,
      nav,
      units,
      navPerUnit,
      dailyReturn: navPerUnit != null && base ? navPerUnit / base - 1 : null,
      cash,
      grossExposure: gross,
      netFlow,
      values,
      bySleeve,
      byMetal,
      pnl,
      cumPnl: { ...cumPnl },
      cumContrib: { ...cumContrib },
    })
    prevNav = nav
    prevNpu = navPerUnit
    prevValues = values
  }

  return { points, units: unitEntries, positions, cashByAccount, marks, warnings: [...warnings] }
}

function markFor(inst: Instrument, p: PositionState, date: string, prices: PriceBook): Mark | null {
  const px = inst.priceSymbol ? prices.close(inst.priceSymbol, date) : null
  // Prefer a trade price printed today over a stale close.
  if (px && !(p.lastTradeDate === date && px.date < date)) return { price: px.price, date: px.date, fallback: false }
  if (p.lastTradePrice != null && p.lastTradeDate != null) return { price: p.lastTradePrice, date: p.lastTradeDate, fallback: true }
  return px ? { price: px.price, date: px.date, fallback: false } : null
}

/** In-memory PriceBook over date-sorted closes per symbol (carry-forward). */
export class MemoryPriceBook implements PriceBook {
  private series = new Map<string, { dates: string[]; closes: number[] }>()

  set(symbol: string, bars: { date: string; close: number }[]): void {
    const sorted = [...bars].filter((b) => Number.isFinite(b.close) && b.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1))
    this.series.set(symbol, { dates: sorted.map((b) => b.date), closes: sorted.map((b) => b.close) })
  }

  has(symbol: string): boolean {
    return (this.series.get(symbol)?.dates.length ?? 0) > 0
  }

  dates(symbol: string): string[] {
    return this.series.get(symbol)?.dates ?? []
  }

  close(symbol: string, date: string): { price: number; date: string } | null {
    const s = this.series.get(symbol)
    if (!s || s.dates.length === 0) return null
    let lo = 0
    let hi = s.dates.length - 1
    if (s.dates[0] > date) return null
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (s.dates[mid] <= date) lo = mid
      else hi = mid - 1
    }
    return { price: s.closes[lo], date: s.dates[lo] }
  }
}
