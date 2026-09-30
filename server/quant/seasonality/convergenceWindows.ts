/**
 * Convergence vs directional seasonality + the BAND-CROSSING requirement
 * (EngineMR — Mikel's method #7).
 *
 * Two kinds of seasonal pattern: DIRECTIONAL (the spread drifts one way over a
 * window) and CONVERGENCE (it is pulled back across a level each year). They need
 * different evidence. For convergence the danger is mining windows until something
 * "looks" convergent, so the guard-rail is a REAL excursion: within a trusted
 * window the series must actually CROSS a band (e.g. from below −2σ to above +2σ),
 * not merely tap zero. A window with ZERO band-crossings is NEVER emitted.
 *
 * Two further gates before a window is trusted: a minimum number of years
 * (`minYears`, default 8) and OUT-OF-SAMPLE confirmation (`needsOos: true`, applied
 * by the caller via `walkForwardSeasonal`). PURE.
 */

/**
 * Does the (z-normalized) path make a real excursion ACROSS the band — travel from
 * ≤ `lower` to ≥ `upper`, or from ≥ `upper` to ≤ `lower`? Merely touching zero, or
 * sitting inside the band, does not count. PURE.
 */
export function bandCrossing(z: number[], lower = -2, upper = 2): boolean {
  let seenBelow = false;
  let seenAbove = false;
  for (const v of z) {
    if (v <= lower) {
      if (seenAbove) return true; // came from above → crossed down-through
      seenBelow = true;
    } else if (v >= upper) {
      if (seenBelow) return true; // came from below → crossed up-through
      seenAbove = true;
    }
  }
  return false;
}

/**
 * Classify a seasonal pattern from each year's NET move over the window. Consistent
 * sign across most years ⇒ directional; mixed / mean-reverting ⇒ convergence. PURE.
 */
export function classifySeasonalType(perYearNet: number[], consistency = 0.7): "directional" | "convergence" {
  if (perYearNet.length === 0) return "convergence";
  const pos = perYearNet.filter((x) => x > 0).length;
  const neg = perYearNet.filter((x) => x < 0).length;
  const dominant = Math.max(pos, neg) / perYearNet.length;
  return dominant >= consistency ? "directional" : "convergence";
}

export interface PerYearPath {
  year: number;
  z: number[]; // z-normalized path over the candidate window (chronological)
}

export interface ConvergenceWindow {
  entryDoy: number;
  exitDoy: number;
  years: number; // total years observed in the window
  crossings: number; // years where the band was genuinely crossed
  needsOos: true; // never trusted without the caller's OOS confirmation
}

/**
 * Build a convergence window only if it clears all guard-rails: at least `minYears`
 * years observed, AND the band was genuinely crossed in at least `minCrossings`
 * (default = a majority of the observed years, and always > 0). Returns null when
 * the window has ZERO crossings (it is never emitted) or too few years. PURE.
 */
export function findConvergenceWindow(
  entryDoy: number,
  exitDoy: number,
  perYear: PerYearPath[],
  opts: { lower?: number; upper?: number; minYears?: number; minCrossings?: number } = {},
): ConvergenceWindow | null {
  const { lower = -2, upper = 2, minYears = 8 } = opts;
  const years = perYear.length;
  if (years < minYears) return null;
  const crossings = perYear.filter((p) => bandCrossing(p.z, lower, upper)).length;
  const minCrossings = opts.minCrossings ?? Math.ceil(years / 2);
  if (crossings === 0 || crossings < minCrossings) return null; // zero band-crossings ⇒ never emitted
  return { entryDoy, exitDoy, years, crossings, needsOos: true };
}
