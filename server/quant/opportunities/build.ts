import type { MlPrediction, Opportunity, SeriesPoint, SignalRow } from "../types/index.js";
import { dayOfYear } from "../engine/climatology.js";
import { findSeasonalWindows } from "../seasonality/findWindows.js";
import { seasonalWindowStats } from "../seasonality/windowStats.js";

/**
 * Inputs for one instrument's opportunity assessment as-of a date. The series is
 * the full $-scaled spread/price history; `latest` is the current convergence
 * signal (z, tier, score); `ml` is the optional gated prediction.
 */
export interface OppInput {
  instrumentId: string;
  label: string;
  asOf: string;
  pointValue: number;
  series: SeriesPoint[];
  latest: SignalRow | null;
  ml?: MlPrediction | null;
}

const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

/**
 * Compose a single ranked opportunity. The composite rank is a TRANSPARENT
 * weighted sum (no black box):
 *   rank = convergenceScore                                  (0..100)
 *        + seasonalBoost  (winRate·30, signed by alignment)  (−15..+30)
 *        + mlBoost        ((pConverge−0.5)·40, gated)        (−20..+20)
 * "Alignment" = the active seasonal window's side agrees with the mean-reversion
 * (fade) direction implied by z. Seasonal windows are computed on PRIOR years
 * only (exclude the current, incomplete year) for look-ahead safety. PURE.
 */
export function buildOpportunity(input: OppInput): Opportunity {
  const { instrumentId, label, asOf, pointValue, series, latest, ml } = input;
  const doy = dayOfYear(asOf);
  const currentYear = Number(asOf.slice(0, 4));
  const evidence: string[] = [];

  // 1) Convergence signal
  const score = latest?.score ?? 0;
  const z = latest?.z ?? 0;
  const tier = latest?.tier ?? "WATCH";
  if (latest) evidence.push(`z=${z.toFixed(2)} (${tier}), convergence score ${score.toFixed(0)}`);
  const fadeDir = -sign(z); // mean-reversion: high spread → expect down (short)

  // 2) Active seasonal window (prior years only)
  const priorSeries = series.filter((p) => Number(p.date.slice(0, 4)) < currentYear);
  const windows = findSeasonalWindows(priorSeries, {
    minWinRate: 0.75,
    minYears: Math.max(5, 0),
    pointValue,
    topN: 40,
  });
  const active = windows.find((w) => doy >= w.entryDoy && doy <= w.exitDoy) ?? null;
  let seasonalBoost = 0;
  let alignedOut: boolean | null = null;
  if (active) {
    const seasonalDir = active.side === "long" ? 1 : -1;
    const aligned = fadeDir === 0 ? true : seasonalDir === fadeDir;
    alignedOut = aligned;
    seasonalBoost = active.winRate * (aligned ? 30 : -15);
    evidence.push(
      `inside ${active.side} seasonal window (hist ${(active.winRate * 100).toFixed(0)}% / ${active.years}y, avg $${active.avgPnl}, t=${active.tStat})` +
        (aligned ? " — agrees with z" : " — CONFLICTS with z"),
    );
  }

  // 3) ML factor (only when validated)
  let mlBoost = 0;
  let mlProb: number | null = null;
  let expectedMove: number | null = null;
  if (ml && ml.validationStatus === "passed") {
    mlProb = ml.pConverge;
    expectedMove = ml.expectedMove;
    mlBoost = (ml.pConverge - 0.5) * 40;
    evidence.push(`ML p(converge)=${(ml.pConverge * 100).toFixed(0)}%, exp $${ml.expectedMove.toFixed(0)} [validated]`);
  } else if (ml) {
    evidence.push(`ML present but ${ml.validationStatus} — not counted`);
  }

  const compositeRank = Number((score + seasonalBoost + mlBoost).toFixed(2));

  return {
    instrumentId,
    label,
    asOf,
    z: Number(z.toFixed(4)),
    tier,
    score: Number(score.toFixed(2)),
    seasonalWindow: active,
    aligned: alignedOut,
    mlProb,
    expectedMove,
    compositeRank,
    evidence,
  };
}

/** Build and rank opportunities across the universe (highest compositeRank first). */
export function buildOpportunities(inputs: OppInput[]): Opportunity[] {
  return inputs.map(buildOpportunity).sort((a, b) => b.compositeRank - a.compositeRank);
}

/** Helper: realized stats for a specific historical window (for evidence drill-down). */
export { seasonalWindowStats };
