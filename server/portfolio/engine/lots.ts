// FIFO lot matching with signed quantities. One routine serves ETFs, miners,
// physical metal (multiplier 1, acquisition fees folded into cost) and futures
// (multiplier = oz/contract, fees expensed separately by the caller).

export interface Lot {
  txnId: number | null
  accountId: number | null
  openDate: string
  /** Signed quantity: + long, − short. */
  qty: number
  /** Per-unit cost in price terms (incl. acquisition fees when feesInCost). */
  unitCost: number
}

export interface FillOptions {
  /** Price-to-dollar multiplier (1 for shares/oz, oz/contract for futures). */
  multiplier?: number
  fees?: number
  /** Fold fees into lot cost / realized P&L (true) or leave them to the caller (futures). */
  feesInCost?: boolean
  date: string
  txnId?: number | null
  accountId?: number | null
}

export interface FillResult {
  realized: number
  /** Absolute quantity closed against existing lots. */
  closedQty: number
  opened: Lot | null
  /** True when the fill had to consume lots held in another account. */
  crossedAccounts: boolean
}

const EPS = 1e-9

export function sign(x: number): number {
  return x > EPS ? 1 : x < -EPS ? -1 : 0
}

/**
 * Apply a signed fill (+ buy, − sell) to `lots` in place. Closes opposite-sign
 * lots FIFO (lots in the fill's account first), then opens a lot with any
 * remainder. Returns realized P&L in dollars.
 */
export function applyFill(lots: Lot[], signedQty: number, price: number, opts: FillOptions): FillResult {
  const mult = opts.multiplier ?? 1
  const fees = opts.fees ?? 0
  const feesInCost = opts.feesInCost ?? true
  const dir = sign(signedQty)
  const total = Math.abs(signedQty)
  if (dir === 0) return { realized: 0, closedQty: 0, opened: null, crossedAccounts: false }

  let remaining = total
  let realized = 0
  let crossed = false

  const candidates = lots
    .map((lot, index) => ({ lot, index }))
    .filter(({ lot }) => sign(lot.qty) === -dir)
    .sort((a, b) => {
      const pa = opts.accountId == null || a.lot.accountId === opts.accountId ? 0 : 1
      const pb = opts.accountId == null || b.lot.accountId === opts.accountId ? 0 : 1
      return pa - pb || a.index - b.index
    })

  for (const { lot } of candidates) {
    if (remaining <= EPS) break
    const q = Math.min(remaining, Math.abs(lot.qty))
    const lotSign = sign(lot.qty)
    realized += lotSign * q * mult * (price - lot.unitCost)
    lot.qty -= lotSign * q
    remaining -= q
    if (opts.accountId != null && lot.accountId !== opts.accountId) crossed = true
  }
  for (let i = lots.length - 1; i >= 0; i--) if (Math.abs(lots[i].qty) <= EPS) lots.splice(i, 1)

  const closedQty = total - remaining
  const closedFrac = closedQty / total
  if (feesInCost) realized -= fees * closedFrac

  let opened: Lot | null = null
  if (remaining > EPS) {
    const openFees = feesInCost ? fees * (1 - closedFrac) : 0
    opened = {
      txnId: opts.txnId ?? null,
      accountId: opts.accountId ?? null,
      openDate: opts.date,
      qty: dir * remaining,
      unitCost: price + (dir * openFees) / (remaining * mult),
    }
    lots.push(opened)
  }
  return { realized, closedQty, opened, crossedAccounts: crossed }
}

/**
 * Move `qty` (> 0) of a long position from one account to another, FIFO,
 * preserving each lot's open date and cost. Returns the quantity moved.
 */
export function transferLots(lots: Lot[], qty: number, fromAccount: number, toAccount: number): number {
  let remaining = qty
  const out: Lot[] = []
  for (const lot of lots) {
    if (remaining <= EPS) break
    if (lot.accountId !== fromAccount || sign(lot.qty) === 0) continue
    const q = Math.min(remaining, Math.abs(lot.qty))
    const s = sign(lot.qty)
    lot.qty -= s * q
    out.push({ ...lot, qty: s * q, accountId: toAccount })
    remaining -= q
  }
  for (let i = lots.length - 1; i >= 0; i--) if (Math.abs(lots[i].qty) <= EPS) lots.splice(i, 1)
  lots.push(...out)
  lots.sort((a, b) => (a.openDate < b.openDate ? -1 : a.openDate > b.openDate ? 1 : (a.txnId ?? 0) - (b.txnId ?? 0)))
  return qty - remaining
}

export function netQty(lots: Lot[]): number {
  return lots.reduce((s, l) => s + l.qty, 0)
}

/** Sum of qty × unitCost × multiplier (signed): the cost basis of open lots. */
export function costBasis(lots: Lot[], multiplier = 1): number {
  return lots.reduce((s, l) => s + l.qty * l.unitCost * multiplier, 0)
}
