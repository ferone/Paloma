/**
 * Regime filter (EngineMR — the discipline behind Mikel's butterfly method #1).
 *
 * A curve also bends for REAL reasons — a supply shock, storage saturation, a flip
 * into backwardation. Fading the bow then is fading a market that is correctly
 * repricing carry. So a reversion signal (the fly) must be GATED: if the curve's
 * own slope or the outright level is breaking out of its recent noise band, the
 * distortion is likely structural and the fly is downgraded, NOT traded.
 *
 * PURE + look-ahead-safe (mirrors the `lib/engine/volatility.ts` dampener shape):
 * the caller passes only values ≤ asOf, and the trailing band uses only that
 * history. Nothing here fetches or reads the clock.
 */

export interface NoiseBand {
  mean: number;
  sd: number;
  /** Latest value's distance from the mean, in standard deviations (signed). */
  zNow: number;
}

/** Trailing mean/σ over the last `n` points + how many σ the latest sits from it. */
export function noiseBand(series: number[], n = 60): NoiseBand | null {
  if (series.length < Math.max(5, Math.floor(n / 2))) return null;
  const w = series.slice(-n);
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  const v = w.reduce((a, b) => a + (b - mean) ** 2, 0) / (w.length - 1 || 1);
  const sd = Math.sqrt(v);
  const last = series[series.length - 1];
  const zNow = sd > 0 ? (last - mean) / sd : 0;
  return { mean, sd, zNow };
}

/**
 * Is the latest move STRUCTURAL? True when any monitored series (the outright
 * level and/or the curve slope) is breaking out of its own trailing noise band
 * beyond `k` σ. A series with too little history is treated as NOT structural
 * (don't manufacture a regime from thin data). PURE.
 */
export function isStructuralMove(monitored: number[][], n = 60, k = 2.5): boolean {
  for (const s of monitored) {
    const band = noiseBand(s, n);
    if (band && Math.abs(band.zNow) >= k) return true;
  }
  return false;
}

export interface FlyGate {
  tradable: boolean;
  reason: string;
}

/**
 * Gate a butterfly reversion signal. The fly is tradable only when (a) the bow is
 * genuinely stretched (|flyZ| ≥ `minZ`) AND (b) the move is NOT structural. It can
 * NEVER return `tradable: true` during a structural move in slope/outright — the
 * spec's core requirement. PURE.
 */
export function gateFly(flyZ: number, structural: boolean, minZ = 1.5): FlyGate {
  if (structural) return { tradable: false, reason: "structural move — curve slope/outright breaking its noise band; fly downgraded, not traded" };
  if (!Number.isFinite(flyZ) || Math.abs(flyZ) < minZ) return { tradable: false, reason: `bow not stretched enough (|z| < ${minZ})` };
  return { tradable: true, reason: `bow stretched (z=${flyZ.toFixed(2)}) within a normal regime — fade to centre` };
}
