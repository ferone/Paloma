/**
 * CONVERGENCE DECISION — how all the evidence streams come together into one call.
 *
 * Philosophy: a great decision is the AGREEMENT of INDEPENDENT lenses, each with a
 * different failure mode, on the same question — "is this a good convergence trade
 * right now?". We triangulate up to six lenses:
 *   1. statistical  — is the spread stretched? (the z-score mean-reversion trigger)
 *   2. seasonal     — does the OOS-VALIDATED calendar window agree? (robust > in-sample)
 *   3. fundamental  — do supply/demand balances support or contradict the move?
 *   4. volatility   — is the regime calm (reversion reliable) or a blow-up (treacherous)?
 *   5. ml           — does the GATED pooled model see convergence odds?
 *   6. news         — does the AI analyst's sourced, qualitative read corroborate? (advisory)
 *
 * DISCIPLINE (load-bearing): the quant engine's BUY/SELL/AVOID verdict is the
 * structural backbone — reproducible + look-ahead-safe. This layer NEVER changes the
 * score; it only MEASURES how strongly the independent lenses corroborate the verdict
 * (conviction) and flags the dangerous case where the SURFACE lenses (z, score) look
 * tradeable but the DEEPER lenses (failed OOS / contradicting fundamentals / the AI
 * "trap" flag) disagree — the "looks like a buy but isn't". PURE (primitives in), so
 * it composes live AND replays at any past date, exactly like `verdict.ts`.
 */

export type Verdict3 = "BUY" | "SELL" | "AVOID";
export type LensStance = "supports" | "contradicts" | "neutral" | "absent";
export type LensKey = "statistical" | "seasonal" | "fundamental" | "volatility" | "ml" | "news";

export interface EvidenceLens {
  key: LensKey;
  label: string;
  stance: LensStance; // relative to the engine's VERDICT (does this lens corroborate it?)
  weight: number; // 0..1 reliability (OOS-validated / gated lenses weigh more)
  detail: string; // one-line human-readable read
}

export interface AiLens {
  stance: "buy" | "avoid";
  looksLikeBuy: boolean;
  alignsWithFundamentals: boolean;
  confidence: "high" | "moderate" | "low";
  thesis: string;
  topRisk?: string;
}

export interface DecisionInput {
  verdict: Verdict3; // engine backbone: BUY = long, SELL = short, AVOID = stand aside
  z: number | null;
  score: number | null;
  avoidOverride: boolean;
  fundFactor: number | null; // engine factor: >0 fundamentals support the fade, <0 contradict
  validationStatus: "passed" | "failed" | "untested";
  seasonalAligned: boolean | null; // OOS window agrees with the fade direction
  regimeRobust: boolean | null; // survives dropping macro-shock years
  mlPConverge: number | null;
  mlValidated: boolean;
  volPercentile: number | null; // 0..1: current HV of the spread vs its own history (advisory)
  ai: AiLens | null;
}

export interface ConvergenceDecision {
  verdict: Verdict3;
  lenses: EvidenceLens[];
  supportsW: number; // summed weight of corroborating lenses
  contradictsW: number; // summed weight of conflicting lenses
  conviction: number; // 0..100
  convictionLabel: "high" | "moderate" | "low" | "conflicted";
  trap: boolean; // looks-like-a-buy-but-isn't
  headline: string;
  thesis?: string; // from the AI lens (advisory)
  counter?: string; // strongest counter-argument (AI top risk)
  aiConfidence?: "high" | "moderate" | "low";
}

type Vote = "pro" | "con" | "neutral" | "absent"; // a lens's read on "attractive convergence trade?"
const AI_W: Record<AiLens["confidence"], number> = { high: 0.8, moderate: 0.55, low: 0.35 };

/** Each lens votes on "is this an attractive convergence trade now?" (independent of the verdict). */
function votes(i: DecisionInput): { key: LensKey; label: string; vote: Vote; weight: number; detail: string }[] {
  const out: { key: LensKey; label: string; vote: Vote; weight: number; detail: string }[] = [];

  // 1. statistical — stretched ⇒ reversion expected
  const az = i.z == null ? null : Math.abs(i.z);
  out.push({
    key: "statistical",
    label: "Statistical stretch",
    vote: az == null ? "absent" : az >= 1.5 ? "pro" : az >= 1 ? "pro" : "con",
    weight: az != null && az >= 1.5 ? 0.9 : 0.7,
    detail: az == null ? "no z-score" : `z ${i.z!.toFixed(2)} — ${az >= 1.5 ? "richly stretched" : az >= 1 ? "moderately stretched" : "near the mean (no edge)"}`,
  });

  // 2. seasonal — OOS-validated window, robust > in-sample
  let sVote: Vote = "neutral";
  let sW = 0.3;
  let sDet = "seasonal edge untested";
  if (i.validationStatus === "passed") {
    if (i.seasonalAligned) {
      sVote = "pro";
      sW = i.regimeRobust === false ? 0.7 : 1.0;
      sDet = `OOS-validated window agrees${i.regimeRobust === false ? " (but regime-fragile)" : i.regimeRobust ? " (regime-robust)" : ""}`;
    } else if (i.seasonalAligned === false) {
      sVote = "con";
      sW = 0.8;
      sDet = "OOS window points the OTHER way";
    } else {
      sVote = "pro";
      sW = 0.7;
      sDet = "OOS-validated edge";
    }
  } else if (i.validationStatus === "failed") {
    sVote = "con";
    sW = 0.7;
    sDet = "edge FAILED out-of-sample";
  }
  out.push({ key: "seasonal", label: "Seasonality (OOS)", vote: sVote, weight: sW, detail: sDet });

  // 3. fundamental — supply/demand (none wired for metals → absent)
  const ff = i.fundFactor;
  out.push({
    key: "fundamental",
    label: "Fundamentals",
    vote: ff == null ? "absent" : ff > 0.1 ? "pro" : ff < -0.1 ? "con" : "neutral",
    weight: 0.6,
    detail: ff == null ? "price-only (no fundamentals)" : ff > 0.1 ? "supply/demand supports the fade" : ff < -0.1 ? "fundamentals contradict the fade" : "fundamentals neutral",
  });

  // 4. volatility regime — calm ⇒ reversion reliable
  const vp = i.volPercentile;
  out.push({
    key: "volatility",
    label: "Volatility regime",
    vote: vp == null ? "absent" : vp <= 0.6 ? "pro" : vp >= 0.85 ? "con" : "neutral",
    weight: 0.5,
    detail: vp == null ? "no volatility read" : vp <= 0.6 ? "calm — mean-reversion reliable" : vp >= 0.85 ? "vol blow-up — reversion treacherous" : "average volatility",
  });

  // 5. ML — gated only
  const p = i.mlPConverge;
  out.push({
    key: "ml",
    label: "ML forecast (gated)",
    vote: !i.mlValidated || p == null ? "absent" : p >= 0.55 ? "pro" : p <= 0.45 ? "con" : "neutral",
    weight: i.mlValidated ? 0.6 : 0,
    detail: !i.mlValidated || p == null ? "model not validated (observed only)" : `p(converge) ${(p * 100).toFixed(0)}%`,
  });

  // 6. news / AI analyst — advisory, catches the trap
  const ai = i.ai;
  out.push({
    key: "news",
    label: "AI analyst (news)",
    vote: !ai ? "absent" : ai.looksLikeBuy ? "con" : ai.stance === "buy" && ai.alignsWithFundamentals ? "pro" : ai.stance === "avoid" ? "con" : "neutral",
    weight: ai ? AI_W[ai.confidence] : 0,
    detail: !ai ? "no analyst note yet" : ai.looksLikeBuy ? "flags a looks-like-a-buy trap" : ai.alignsWithFundamentals ? "news corroborates" : "news does not corroborate",
  });

  return out;
}

/** Reconcile each lens's trade-vote against the verdict and synthesize the decision. PURE. */
export function assembleDecision(i: DecisionInput): ConvergenceDecision {
  const tradeFavored = i.verdict === "BUY" || i.verdict === "SELL"; // the engine recommends a trade
  const raw = votes(i);

  const lenses: EvidenceLens[] = raw.map((r) => {
    let stance: LensStance;
    if (r.vote === "absent") stance = "absent";
    else if (r.vote === "neutral") stance = "neutral";
    else {
      const pro = r.vote === "pro";
      // For a trade verdict, a pro vote supports it. For AVOID, a CON vote (no trade)
      // supports the stand-aside; a pro vote contradicts it (it looked tradeable → tension).
      stance = tradeFavored ? (pro ? "supports" : "contradicts") : pro ? "contradicts" : "supports";
    }
    return { key: r.key, label: r.label, stance, weight: r.weight, detail: r.detail };
  });

  const supportsW = lenses.filter((l) => l.stance === "supports").reduce((a, l) => a + l.weight, 0);
  const contradictsW = lenses.filter((l) => l.stance === "contradicts").reduce((a, l) => a + l.weight, 0);
  const total = supportsW + contradictsW;
  const conviction = total > 0 ? Math.round((supportsW / total) * 100) : 50;
  const convictionLabel: ConvergenceDecision["convictionLabel"] =
    contradictsW > supportsW ? "conflicted" : conviction >= 70 ? "high" : conviction >= 55 ? "moderate" : "low";

  // "Looks like a buy but isn't": the engine is NOT endorsing a long, yet the surface
  // (a stretched z OR a high score) looks tradeable, while the deeper lenses or the AI
  // disagree — the convergence layer's headline warning.
  const surfaceAppeal = (i.z != null && Math.abs(i.z) >= 1.5) || (i.score != null && i.score >= 45);
  const deeperDisagree = i.validationStatus === "failed" || i.ai?.looksLikeBuy === true || contradictsW >= supportsW || i.avoidOverride;
  const trap = i.verdict !== "BUY" && surfaceAppeal && deeperDisagree;

  const nSupport = lenses.filter((l) => l.stance === "supports").length;
  const nActive = lenses.filter((l) => l.stance === "supports" || l.stance === "contradicts").length;
  const verb = i.verdict === "AVOID" ? "standing aside" : `the ${i.verdict}`;
  const headline = trap
    ? `Looks like a buy, but ${lenses.filter((l) => l.stance === "contradicts").length} lens(es) disagree — stand aside.`
    : nActive === 0
      ? "Not enough independent evidence to converge yet."
      : `${convictionLabel === "conflicted" ? "Conflicted" : convictionLabel[0].toUpperCase() + convictionLabel.slice(1)} conviction — ${nSupport} of ${nActive} lenses corroborate ${verb}.`;

  return {
    verdict: i.verdict,
    lenses,
    supportsW: Number(supportsW.toFixed(2)),
    contradictsW: Number(contradictsW.toFixed(2)),
    conviction,
    convictionLabel,
    trap,
    headline,
    thesis: i.ai?.thesis,
    counter: i.ai?.topRisk,
    aiConfidence: i.ai?.confidence,
  };
}
