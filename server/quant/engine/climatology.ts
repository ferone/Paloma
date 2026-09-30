import { clamp } from "./math.js";
import { calibrateScale } from "./calibrate.js";

/**
 * Seasonal climatology (SPEC §4.2). Pure.
 *
 * LOOK-AHEAD NOTE: these functions average over whatever history they are given.
 * Walk-forward safety comes from `features/buildAsOf` truncating prices to ≤ t
 * BEFORE this is called, so at as-of t the climatology only ever sees the past.
 */

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Day-of-year (1..366) from an ISO YYYY-MM-DD string. Pure, timezone-free. */
export function dayOfYear(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  let doy = d;
  for (let i = 0; i < m - 1; i++) doy += DAYS_IN_MONTH[i];
  if (m > 2 && isLeap(y)) doy += 1;
  return doy;
}

/**
 * Day-of-year climatology: average spread by day-of-year across the supplied
 * history, gaps filled by nearest available, then smoothed with a centered
 * moving average that wraps around the year. Returns an array indexed 1..366
 * (index 0 unused).
 */
export function buildClimatology(
  history: { date: string; spread: number }[],
  smoothWindow = 15,
): number[] {
  const sum = new Array<number>(367).fill(0);
  const cnt = new Array<number>(367).fill(0);
  for (const { date, spread } of history) {
    const d = dayOfYear(date);
    sum[d] += spread;
    cnt[d] += 1;
  }
  const raw = new Array<number>(367).fill(NaN);
  for (let d = 1; d <= 366; d++) if (cnt[d] > 0) raw[d] = sum[d] / cnt[d];
  return smooth(fillGaps(raw), smoothWindow);
}

function fillGaps(raw: number[]): number[] {
  const out = raw.slice();
  let last = NaN;
  for (let d = 1; d <= 366; d++) {
    if (!Number.isNaN(out[d])) last = out[d];
    else if (!Number.isNaN(last)) out[d] = last;
  }
  let next = NaN;
  for (let d = 366; d >= 1; d--) {
    if (!Number.isNaN(out[d])) next = out[d];
    else if (!Number.isNaN(next)) out[d] = next;
  }
  return out;
}

function smooth(arr: number[], win: number): number[] {
  if (win <= 1) return arr;
  const out = new Array<number>(367).fill(NaN);
  const half = Math.floor(win / 2);
  for (let d = 1; d <= 366; d++) {
    let s = 0;
    let c = 0;
    for (let k = -half; k <= half; k++) {
      let idx = d + k;
      if (idx < 1) idx += 366;
      if (idx > 366) idx -= 366;
      const v = arr[idx];
      if (!Number.isNaN(v)) {
        s += v;
        c += 1;
      }
    }
    out[d] = c > 0 ? s / c : NaN;
  }
  return out;
}

/** Expected seasonal drift over horizon H (SPEC §4.2): clim(d+H) − clim(d), wrapping. */
export function seasonalDrift(clim: number[], dayOfYearStart: number, H: number): number {
  const at = (d: number): number => {
    let i = d;
    while (i > 366) i -= 366;
    while (i < 1) i += 366;
    return clim[i];
  };
  const a = at(dayOfYearStart);
  const b = at(dayOfYearStart + H);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return b - a;
}

/**
 * Per-instrument seasonal SCALE: the p-th percentile (default 0.8) of
 * |seasonalDrift| over the whole year. This NORMALIZES the season factor so it is
 * scale-free across instruments whose spread units differ by orders of magnitude
 * (a cents-quoted calendar spread vs a $-denominated crush whose Δseason is ~10³×
 * larger). Computed from the as-of climatology, so it is look-ahead-safe; a flat
 * (degenerate) climatology returns 1 (the neutral default). PURE.
 */
export function seasonalDriftScale(clim: number[], H: number, percentile = 0.8): number {
  const drifts: number[] = [];
  for (let d = 1; d <= 366; d++) drifts.push(seasonalDrift(clim, d, H));
  return calibrateScale(drifts, percentile);
}

/**
 * Season alignment factor (SPEC §4.2):
 *   f = −sign(z) (fade toward the mean); season_factor = clamp(f·Δseason/k_s, −1, 1).
 * Positive when the seasonal drift agrees with the fade direction. `kSeason` here
 * is the EFFECTIVE scale (per-instrument `seasonalDriftScale` × the dimensionless
 * `Config.kSeason` global knob — composed in `scoreAsOf`).
 */
export function seasonFactor(z: number, deltaSeason: number, kSeason: number): number {
  const f = -Math.sign(z);
  return clamp((f * deltaSeason) / kSeason, -1, 1);
}
