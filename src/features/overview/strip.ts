/**
 * Column count for a strip of `n` equal tiles when at most `maxCols` fit.
 * Prefers a count that leaves no ragged last row (n divisible by c); otherwise
 * the one whose last row is fullest. Never goes below half the columns that
 * fit (tiles would get needlessly wide) and never above n.
 */
export function pickColumns(n: number, maxCols: number): number {
  if (n <= 0) return 1
  const hi = Math.max(1, Math.min(n, Math.floor(maxCols)))
  if (hi >= n) return n
  const lo = Math.max(1, Math.ceil(hi / 2))
  let best = hi
  let bestFill = -1
  for (let c = hi; c >= lo; c--) {
    const rem = n % c
    const fill = rem === 0 ? 1 : rem / c
    if (fill > bestFill + 1e-9) {
      best = c
      bestFill = fill
    }
    if (fill === 1) break
  }
  return best
}
