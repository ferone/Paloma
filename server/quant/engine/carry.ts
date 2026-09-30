import type { InstrumentKind, QtParams, SeriesPoint } from "../types/index.js";

/**
 * Carry / term-structure read for EngineQT, derived from the STRUCTURES the
 * store already holds (no new data): per product,
 *
 *   c0 = out,   c1 = out − cal01,   c2 = fly012 + out − 2·cal01
 *
 * (exact identities of the stored leg weights: cal01 = c0−c1, fly = c0−2c1+c2).
 *
 * The read is used two ways, both gates/corroboration — never a score multiplier:
 *  - `slopePctile` corroborates a CALENDAR fade (a rich calendar with the slope
 *    in its bottom quintile has the curve on its side);
 *  - `trending` is the VETO: never fade a curve whose slope is in structural
 *    motion (the "don't fight the trend" guard, same family as the fly's
 *    structural-move regime gate).
 *
 * PURE (no IO/Date). All windows/thresholds come from QtParamsSchema.
 */

export interface CurvePoint {
  date: string;
  c0: number;
  c1: number;
  c2: number;
}

/** Minimum slope observations before a percentile is meaningful. */
const MIN_PCTILE_OBS = 120;

/** Derive the forward curve from stored structures, aligned by date (inner join). */
export function deriveCurve(out: SeriesPoint[], cal01: SeriesPoint[], fly012: SeriesPoint[]): CurvePoint[] {
  const calBy = new Map(cal01.map((p) => [p.date, p.value]));
  const flyBy = new Map(fly012.map((p) => [p.date, p.value]));
  const curve: CurvePoint[] = [];
  for (const p of out) {
    const cal = calBy.get(p.date);
    const fly = flyBy.get(p.date);
    if (cal === undefined || fly === undefined) continue;
    curve.push({ date: p.date, c0: p.value, c1: p.value - cal, c2: fly + p.value - 2 * cal });
  }
  return curve;
}

export interface CarryRead {
  /** c1 − c0 in price units; > 0 ⇒ contango for these markets. */
  slope: number;
  regime: "contango" | "backwardation" | "flat";
  /** Percentile of the latest slope within the trailing pctWindow (null < 120 obs). */
  slopePctile: number | null;
  /** z of the latest momWindow slope-change vs its own trailing changes. */
  slopeMomZ: number | null;
  /** |slopeMomZ| ≥ trendZ — the curve is in structural motion. */
  trending: boolean;
}

/** Read the latest carry state from a (≤ asOf) curve. Null when empty. */
export function carryRead(curve: CurvePoint[], opts: QtParams["carry"]): CarryRead | null {
  if (curve.length === 0) return null;
  const window = curve.slice(-opts.pctWindow);
  const slopes = window.map((c) => c.c1 - c.c0);
  const latest = slopes[slopes.length - 1];
  const c0 = window[window.length - 1].c0;

  const regime: CarryRead["regime"] =
    Math.abs(latest) <= opts.flatEps * Math.abs(c0) ? "flat" : latest > 0 ? "contango" : "backwardation";

  let slopePctile: number | null = null;
  if (slopes.length >= MIN_PCTILE_OBS) {
    let below = 0;
    for (const s of slopes) if (s <= latest) below++;
    slopePctile = below / slopes.length;
  }

  // Momentum: w-day slope changes D_t = slope_t − slope_{t−w}; z-score the latest
  // change against its own trailing distribution.
  let slopeMomZ: number | null = null;
  const w = opts.momWindow;
  if (slopes.length > w + 2) {
    const diffs: number[] = [];
    for (let i = w; i < slopes.length; i++) diffs.push(slopes[i] - slopes[i - w]);
    const latestD = diffs[diffs.length - 1];
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const varSum = diffs.reduce((a, b) => a + (b - mean) * (b - mean), 0);
    const sd = Math.sqrt(varSum / Math.max(1, diffs.length - 1));
    slopeMomZ = sd === 0 ? 0 : (latestD - mean) / sd;
  }

  const trending = slopeMomZ !== null && Math.abs(slopeMomZ) >= opts.trendZ;
  return { slope: latest, regime, slopePctile, slopeMomZ, trending };
}

export type CarryAlignment = "aligned" | "conflict" | "neutral";

/**
 * Map the carry read onto ONE instrument's fade. Only `calendar` gets the
 * percentile corroboration (cal01 = −slope, so a z>0-rich calendar ⇔ LOW slope
 * percentile). `butterfly` gets the trend veto only (its own structural gate
 * already covers level moves). Every other kind → null — never fabricate a
 * carry read for crush/inter/seasonal/outright structures.
 */
export function carryLensFor(
  kind: InstrumentKind,
  z: number,
  read: CarryRead | null,
): { alignment: CarryAlignment; conflict: boolean; detail: string } | null {
  if (!read) return null;
  if (kind !== "calendar" && kind !== "butterfly") return null;

  if (read.trending) {
    return {
      alignment: "conflict",
      conflict: true,
      detail: `curve slope in structural motion (momentum z ${read.slopeMomZ?.toFixed(1) ?? "?"}) — don't fade a trending curve`,
    };
  }

  if (kind === "calendar" && read.slopePctile !== null) {
    const richFade = z > 0.25 && read.slopePctile <= 0.2;
    const cheapFade = z < -0.25 && read.slopePctile >= 0.8;
    if (richFade || cheapFade) {
      return {
        alignment: "aligned",
        conflict: false,
        detail: `${read.regime} curve, slope ${Math.round(read.slopePctile * 100)}th pctile — the curve corroborates this fade`,
      };
    }
  }

  return { alignment: "neutral", conflict: false, detail: `${read.regime} curve, no corroboration either way` };
}
