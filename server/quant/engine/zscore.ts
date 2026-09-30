/** Rolling mean / std / z-score over a trailing window (SPEC §4.1). Pure. */

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (divides by n-1). Returns 0 for n<2 or a constant series. */
export function stdSample(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  const ss = xs.reduce((a, b) => a + (b - m) ** 2, 0);
  return Math.sqrt(ss / (n - 1));
}

/**
 * Z-score of the LAST observation using the trailing window of `n` values
 * (the window ends at and includes the current point), per SPEC §4.1:
 *   μ_t, σ_t over N business days; z_t = (s_t − μ_t) / σ_t.
 * Returns NaN if there are fewer than `n` observations; 0 if σ_t = 0.
 */
export function rollingZScore(spreads: number[], n: number): number {
  if (spreads.length < n) return NaN;
  const w = spreads.slice(-n);
  const m = mean(w);
  const s = stdSample(w);
  if (s === 0) return 0;
  return (w[w.length - 1] - m) / s;
}
