// Type-vs-instrument rules that zod can't express without the instrument table.
import { CASH_AMOUNT_TYPES, type Instrument, type TxnType } from '../../shared/portfolio.js'
import type { InstrumentKind } from '../../shared/universe.js'

const ALLOWED: Record<TxnType, readonly InstrumentKind[]> = {
  buy: ['etf', 'equity', 'physical'],
  sell: ['etf', 'equity', 'physical'],
  futures_open: ['future'],
  futures_close: ['future'],
  subscription: ['cash'],
  redemption: ['cash'],
  interest: ['cash'],
  dividend: ['etf', 'equity', 'cash'],
  fee: ['cash', 'etf', 'equity', 'physical', 'future'],
  storage_fee: ['cash', 'physical'],
  deposit: ['cash', 'etf', 'equity', 'physical'],
  withdrawal: ['cash', 'etf', 'equity', 'physical'],
  transfer: ['cash', 'etf', 'equity', 'physical'],
}

export function validateSemantics(
  t: { type: TxnType; instrumentId: string; price: number; quantity: number },
  instrument: Instrument | undefined,
): string[] {
  if (!instrument) return [`Unknown instrument "${t.instrumentId}"`]
  const errs: string[] = []
  if (!ALLOWED[t.type].includes(instrument.kind))
    errs.push(`${t.type} is not valid for ${instrument.id} (${instrument.kind}); allowed: ${ALLOWED[t.type].join(', ')}`)
  const needsPrice = !CASH_AMOUNT_TYPES.includes(t.type) && t.type !== 'transfer' && instrument.kind !== 'cash'
  if (needsPrice && !(t.price > 0)) errs.push('Price must be positive')
  return errs
}
