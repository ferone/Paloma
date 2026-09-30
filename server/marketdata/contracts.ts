import { MONTH_CODES } from '../../shared/universe.js'
import type { ContractRow } from '../db/shared-repo.js'
import { contractExpiry as quantContractExpiry } from '../quant/universe/contracts.js'

// Contract-month symbology and COMEX expiry rules (ported from
// CommodityFutures lib/universe/contracts.ts). PURE: never reads "now".
//
// CME raw symbols carry a 1-digit year ("GCZ6") that recycles every decade. We
// store the canonical 2-digit form ("GCZ26") and resolve the decade from the
// date of the record the symbol appeared on.

const CODES = MONTH_CODES.join('')

export interface ParsedContract {
  root: string
  month: number
  year: number
  /** Canonical symbol, e.g. GCZ26. */
  symbol: string
}

export function canonicalSymbol(root: string, month: number, year: number): string {
  return `${root}${MONTH_CODES[month - 1]}${String(year % 100).padStart(2, '0')}`
}

/**
 * Outright contract of `root` in 1- or 2-digit-year form? Rejects calendar
 * spreads ("GCZ6-GCG7"), other roots ("MGCZ6" is not a GC outright) and
 * user-defined instruments.
 */
export function outrightRegex(root: string): RegExp {
  return new RegExp(`^${root}([${CODES}])(\\d{1,2})$`)
}

/**
 * Map a raw Databento symbol seen on `recordDate` to its canonical contract.
 * The contract month can't precede the record month (a contract stops trading
 * in its delivery month), so the year is the smallest one whose last digit(s)
 * match and whose contract month is on/after the record month. Returns null
 * for anything that isn't an outright of `root`.
 */
export function parseRawSymbol(raw: string, root: string, recordDate: string): ParsedContract | null {
  const m = outrightRegex(root).exec(raw)
  if (!m) return null
  const month = CODES.indexOf(m[1]) + 1
  const digits = m[2]
  const recYear = Number(recordDate.slice(0, 4))
  const recMonth = Number(recordDate.slice(5, 7))
  const recIndex = recYear * 12 + recMonth
  let year: number
  if (digits.length === 2) {
    const century = Math.floor(recYear / 100) * 100
    year = century + Number(digits)
    if (year * 12 + month < recIndex - 12) year += 100
  } else {
    const d = Number(digits)
    year = recYear - 1
    while (year % 10 !== d || year * 12 + month < recIndex) year++
  }
  return { root, month, year, symbol: canonicalSymbol(root, month, year) }
}

/** Parse a canonical symbol like "GCZ26" (root inferred from the known roots, longest first). */
export function parseCanonical(symbol: string, roots: readonly string[]): ParsedContract | null {
  for (const root of [...roots].sort((a, b) => b.length - a.length)) {
    const m = new RegExp(`^${root}([${CODES}])(\\d{2})$`).exec(symbol)
    if (m) {
      const month = CODES.indexOf(m[1]) + 1
      return { root, month, year: 2000 + Number(m[2]), symbol }
    }
  }
  return null
}

// ── Expiry rules ────────────────────────────────────────────────────────────
// One source of truth: the quant engine's documented CME/COMEX/NYMEX rules
// (server/quant/universe/contracts.ts). COMEX metals: last trade = 3rd-last
// business day of the delivery month, first notice = last business day of the
// prior month. Cash-settled products (CME bitcoin) have no first notice.
// Weekends handled; exchange holidays are NOT (documented approximation).

export const EXPIRY_NOTE =
  'Approx: last trade and first notice follow the documented CME rules per product (cash-settled contracts have no first notice). Weekends handled, exchange holidays not.'

export function contractExpiry(root: string, month: number, year: number): { lastTrade: string | null; firstNotice: string | null } {
  const e = quantContractExpiry(root, month, year)
  if (!e) return { lastTrade: null, firstNotice: null }
  return { lastTrade: e.lastTrade, firstNotice: e.cashSettled ? null : e.firstNotice }
}

export function contractRow(c: ParsedContract): ContractRow {
  const { lastTrade, firstNotice } = contractExpiry(c.root, c.month, c.year)
  return { symbol: c.symbol, root: c.root, year: c.year, month: c.month, lastTrade, firstNotice }
}
