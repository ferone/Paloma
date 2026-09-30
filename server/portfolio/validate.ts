// Type-vs-instrument rules that zod can't express without the instrument table.
import { CASH_AMOUNT_TYPES, TXN_ALLOWED_KINDS, type Instrument, type TxnType } from '../../shared/portfolio.js'

export function validateSemantics(
  t: { type: TxnType; instrumentId: string; price: number; quantity: number },
  instrument: Instrument | undefined,
): string[] {
  if (!instrument) return [`Unknown instrument "${t.instrumentId}"`]
  const errs: string[] = []
  const allowed = TXN_ALLOWED_KINDS[t.type]
  if (!allowed.includes(instrument.kind)) errs.push(`${t.type} is not valid for ${instrument.id} (${instrument.kind}); allowed: ${allowed.join(', ')}`)
  const needsPrice = !CASH_AMOUNT_TYPES.includes(t.type) && t.type !== 'transfer' && instrument.kind !== 'cash'
  if (needsPrice && !(t.price > 0)) errs.push('Price must be positive')
  return errs
}
