// In-process notifications between domains, so a writer (e.g. the marketdata
// Yahoo job landing daily closes) never has to import its readers (e.g. the
// portfolio NAV cache). Listeners must not throw; errors are logged and dropped.

type PricesListener = (symbols: string[]) => void

const pricesListeners = new Set<PricesListener>()

/** Subscribe to "new daily closes were written to prices_daily for these symbols". Returns an unsubscribe. */
export function onPricesWritten(fn: PricesListener): () => void {
  pricesListeners.add(fn)
  return () => pricesListeners.delete(fn)
}

/** Announce that daily closes for `symbols` were written (no-op for an empty list). */
export function emitPricesWritten(symbols: string[]): void {
  if (!symbols.length) return
  for (const fn of pricesListeners) {
    try {
      fn(symbols)
    } catch (err) {
      console.error('[events] prices listener failed', err)
    }
  }
}
