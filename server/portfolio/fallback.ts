import type { Instrument } from '../../shared/portfolio.js'
import type { EngineRun } from './engine/ledger.js'
import { netQty } from './engine/lots.js'

interface RunView {
  run: Pick<EngineRun, 'marks' | 'positions'>
  instruments: Map<string, Instrument>
}

/**
 * Held positions valued at their last trade price because no close was
 * available for their price symbol (e.g. the first valuation after an asset's
 * first trade, before its history finished loading). Never silent: these become
 * summary warnings, and such a result is only cached briefly so it self-heals.
 */
export function fallbackMarks(c: RunView): { instrumentId: string; date: string; priceSymbol: string | null }[] {
  const out: { instrumentId: string; date: string; priceSymbol: string | null }[] = []
  for (const [id, mark] of c.run.marks) {
    if (!mark.fallback) continue
    const lots = c.run.positions.get(id)?.lots
    if (lots && Math.abs(netQty(lots)) > 1e-12) out.push({ instrumentId: id, date: mark.date, priceSymbol: c.instruments.get(id)?.priceSymbol ?? null })
  }
  return out
}

export function fallbackWarnings(c: RunView): string[] {
  return fallbackMarks(c).map(
    (f) => `${f.instrumentId} is valued at its last trade price (${f.date}): no ${f.priceSymbol ?? 'price'} close was available. Recompute once prices have loaded.`,
  )
}
