import { getDb } from '../db/client.js'
import type { CurveHistoryPoint, CurveResponse } from '../../shared/markets.js'
import type { Metal } from '../../shared/universe.js'

/** Store today's curve (latest capture of the day wins). */
export function saveCurveSnapshot(curve: CurveResponse, date = new Date().toISOString().slice(0, 10)): void {
  const ref = curve.contracts.find((c) => c.isReference)
  getDb()
    .prepare(
      `INSERT INTO markets_curve_daily (metal, date, reference_symbol, reference_price, term_carry, rate, shape, contracts, captured_at)
       VALUES (@metal, @date, @refSymbol, @refPrice, @termCarry, @rate, @shape, @contracts, datetime('now'))
       ON CONFLICT (metal, date) DO UPDATE SET
         reference_symbol = excluded.reference_symbol, reference_price = excluded.reference_price,
         term_carry = excluded.term_carry, rate = excluded.rate, shape = excluded.shape,
         contracts = excluded.contracts, captured_at = excluded.captured_at`,
    )
    .run({
      metal: curve.metal,
      date,
      refSymbol: ref?.symbol ?? null,
      refPrice: ref?.price ?? null,
      termCarry: curve.termCarry,
      rate: curve.rate.value,
      shape: curve.shape,
      contracts: JSON.stringify(
        curve.contracts.map((c) => ({ symbol: c.symbol, expiry: c.expiry, price: c.price, openInterest: c.openInterest, volume: c.volume })),
      ),
    })
}

export function readCurveHistory(metal: Metal, limit = 750): CurveHistoryPoint[] {
  const rows = getDb()
    .prepare(
      `SELECT date, term_carry AS termCarry, rate, reference_price AS referencePrice
       FROM markets_curve_daily WHERE metal = ? ORDER BY date DESC LIMIT ?`,
    )
    .all(metal, limit) as CurveHistoryPoint[]
  return rows.reverse()
}
