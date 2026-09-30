import type { InstrumentKind, MlPrediction, QtParams, SignalRow } from "../types/index.js";
import { adaptiveLookback, expectedReversionDays, ouTradability, type OuFit } from "../engine/ou.js";
import type { carryLensFor, CarryAlignment, CarryRead } from "../engine/carry.js";
import { rollingZScore } from "../engine/zscore.js";

/**
 * EngineQT full-universe cross-sectional scanner. Makes ALL stored instruments
 * (calendars, crush, inter, outrights, butterflies AND seasonals) comparable on
 * one transparent composite. The weights are FIXED documented constants from
 * `cfg.qt.rank` — never fitted to P&L — and the veto gates DAMP a rank (×gateDamp),
 * they never hide an instrument: the scanner surfaces everything; the verdict
 * layer decides trade/no-trade.
 *
 * Composite (all weights from `qt.rank`):
 *   base        = kind==="seasonal" ? 50·min(1,|tStat|/3) + (oos passed ? 20 : 0)
 *                                   : latest.score (0..100)
 *   tradability = ouTradable ? tradabilityBonus·(1 − clamp((halfLife−hlMin)/(hlMax−hlMin),0,1)) : 0
 *   carryBoost  = alignment==="aligned" ? carryBonus : 0
 *   oosBoost    = oos passed ? min(oosBonus, oosBonus·min(1, sharpe)) · (survivesRegime===false ? 0.5 : 1) : 0
 *   mlBoost     = ml validated ? (pConverge − 0.5) · 2·mlBonus : 0
 *   qtRank      = (base + tradability + carryBoost + oosBoost + mlBoost) · (any gate failed ? gateDamp : 1)
 *
 * PURE (no IO/Date): every lens is an INPUT computed by the caller from
 * already-as-of-gated data, so the scanner inherits look-ahead safety.
 */

/** The product-level carry lens result (see `lib/engine/carry.ts:carryLensFor`). */
type CarryLens = ReturnType<typeof carryLensFor>;

export interface QtCandidateInput {
  instrumentId: string;
  label: string;
  kind: InstrumentKind;
  product: string;
  asOf: string;
  pointValue: number;
  /** Stored spread values ≤ asOf (ascending). */
  values: number[];
  /** The qt-config engine row (that engine index's `latest`). */
  latest: SignalRow | null;
  /** ouFit(values, cfg.qt.ou.window, cfg.qt.ou.minObs). */
  ou: OuFit | null;
  /** Product-level carry lens, null when N/A (crush/inter/seasonal/outright). */
  carry: CarryLens;
  /** The product-level carry READ behind the lens (regime + slope percentile surface). */
  carryRead?: CarryRead | null;
  /** isStructuralMove regime gate (flies/outright), null when N/A. */
  structural: boolean | null;
  oos: { status: string; sharpe: number; avgPnl: number; years: number; survivesRegime: boolean | null } | null;
  ml: MlPrediction | null;
  /** Seasonal kind only. */
  seasonal: { status: string; tStat: number; inWindow: boolean; side: "long" | "short" } | null;
}

export interface QtOpportunity {
  instrumentId: string;
  label: string;
  kind: string;
  product: string;
  asOf: string;
  /** Fade direction (−sign z) / seasonal window side. */
  side: "long" | "short" | null;
  /** Adaptive-lookback z: rollingZScore(values, adaptiveLookback(ou, k, nMin, nMax)). */
  zEff: number | null;
  nEff: number | null;
  halfLife: number | null;
  expectedDays: number | null;
  gates: { ouTradable: boolean; carryConflict: boolean; structural: boolean };
  carry: { regime: string; slopePctile: number | null; alignment: CarryAlignment } | null;
  /** Transparent composite — see the module header. */
  qtRank: number;
  evidence: string[];
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const round = (x: number, dp: number): number => Number(x.toFixed(dp));

export function buildQtOpportunity(c: QtCandidateInput, qt: QtParams): QtOpportunity {
  const evidence: string[] = [];
  const trad = ouTradability(c.ou, { min: qt.ou.halfLifeMin, max: qt.ou.halfLifeMax });
  const halfLife = trad.halfLife !== null && Number.isFinite(trad.halfLife) ? round(trad.halfLife, 2) : null;

  // Adaptive-lookback z. Fallback lookback when there is no usable fit = nMax
  // (the longest allowed window — the conservative default; a spread we cannot
  // fit gets the slowest z, and its rank is damped by the OU gate anyway).
  const nEff = adaptiveLookback(c.ou, qt.ou.adaptiveK, qt.ou.nMin, qt.ou.nMax, qt.ou.nMax);
  const zRaw = rollingZScore(c.values, nEff);
  const zEff = Number.isFinite(zRaw) ? round(zRaw, 4) : null;
  const expRaw = zEff !== null ? expectedReversionDays(zEff, c.ou) : null;
  const expectedDays = expRaw !== null && Number.isFinite(expRaw) ? round(expRaw, 1) : null;

  const gates = {
    ouTradable: trad.tradable,
    carryConflict: c.carry?.conflict === true,
    structural: c.structural === true,
  };
  const gateFailed = !gates.ouTradable || gates.carryConflict || gates.structural;

  // ── Composite terms (weights from cfg.qt.rank; formula in the module header) ──
  const base =
    c.kind === "seasonal"
      ? 50 * Math.min(1, Math.abs(c.seasonal?.tStat ?? 0) / 3) + (c.oos?.status === "passed" ? 20 : 0)
      : (c.latest?.score ?? 0);
  const tradability =
    gates.ouTradable && halfLife !== null
      ? qt.rank.tradabilityBonus * (1 - clamp01((halfLife - qt.ou.halfLifeMin) / (qt.ou.halfLifeMax - qt.ou.halfLifeMin)))
      : 0;
  const carryBoost = c.carry?.alignment === "aligned" ? qt.rank.carryBonus : 0;
  const oosBoost =
    c.oos && c.oos.status === "passed"
      ? Math.min(qt.rank.oosBonus, qt.rank.oosBonus * Math.min(1, c.oos.sharpe)) * (c.oos.survivesRegime === false ? 0.5 : 1)
      : 0;
  const mlBoost = c.ml && c.ml.validationStatus === "passed" ? (c.ml.pConverge - 0.5) * 2 * qt.rank.mlBonus : 0;
  const qtRank = round((base + tradability + carryBoost + oosBoost + mlBoost) * (gateFailed ? qt.rank.gateDamp : 1), 2);

  // Side: seasonal instruments trade their window's side; everything else fades
  // the adaptive z (falling back to the engine z when the adaptive one is absent).
  const zForSide = zEff ?? c.latest?.z ?? 0;
  const side: QtOpportunity["side"] =
    c.kind === "seasonal" ? (c.seasonal?.side ?? null) : zForSide > 0 ? "short" : zForSide < 0 ? "long" : null;

  // ── Evidence: one line per non-null lens (+ the damping, when applied) ──
  if (c.kind === "seasonal") {
    evidence.push(
      `seasonal |t|=${Math.abs(c.seasonal?.tStat ?? 0).toFixed(2)}${c.seasonal?.inWindow ? ", INSIDE window" : ""} → base ${base.toFixed(1)}`,
    );
  } else {
    evidence.push(`convergence score ${(c.latest?.score ?? 0).toFixed(0)} (z=${(c.latest?.z ?? 0).toFixed(2)}) → base ${base.toFixed(1)}`);
  }
  evidence.push(
    `OU: ${trad.reason}` +
      (gates.ouTradable ? ` → +${tradability.toFixed(1)}; N_eff=${nEff}${expectedDays !== null ? `, ~${expectedDays}d to revert` : ""}` : ""),
  );
  if (c.carry) evidence.push(`carry: ${c.carry.detail}${carryBoost > 0 ? ` → +${carryBoost}` : ""}`);
  if (c.structural !== null)
    evidence.push(c.structural ? "regime: structural move in progress — stand-aside gate ON" : "regime: no structural move");
  if (c.oos)
    evidence.push(
      `OOS ${c.oos.status} (${c.oos.years}y, Sharpe ${c.oos.sharpe}, avg $${c.oos.avgPnl})` +
        (c.oos.survivesRegime === false ? " — regime-FRAGILE (boost halved)" : "") +
        (oosBoost !== 0 ? ` → +${oosBoost.toFixed(1)}` : ""),
    );
  if (c.ml)
    evidence.push(
      `ML p(converge)=${Math.round(c.ml.pConverge * 100)}% [${c.ml.validationStatus}]` +
        (mlBoost !== 0 ? ` → ${mlBoost >= 0 ? "+" : ""}${mlBoost.toFixed(1)}` : " — not counted"),
    );
  if (gateFailed) {
    const failed = [
      !gates.ouTradable ? "OU" : null,
      gates.carryConflict ? "carry" : null,
      gates.structural ? "structural" : null,
    ].filter(Boolean);
    evidence.push(`gate(s) failed (${failed.join(", ")}) → rank damped ×${qt.rank.gateDamp}`);
  }

  return {
    instrumentId: c.instrumentId,
    label: c.label,
    kind: c.kind,
    product: c.product,
    asOf: c.asOf,
    side,
    zEff,
    nEff,
    halfLife,
    expectedDays,
    gates,
    carry: c.carry ? { regime: c.carryRead?.regime ?? "unknown", slopePctile: c.carryRead?.slopePctile ?? null, alignment: c.carry.alignment } : null,
    qtRank,
    evidence,
  };
}

/** Build and rank the whole universe, highest qtRank first. */
export function rankQtOpportunities(cs: QtCandidateInput[], qt: QtParams): QtOpportunity[] {
  return cs.map((c) => buildQtOpportunity(c, qt)).sort((a, b) => b.qtRank - a.qtRank);
}
