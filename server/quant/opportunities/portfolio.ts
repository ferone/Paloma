import type { QtParams } from "../types/index.js";

/**
 * EngineQT portfolio layer — RISK PLUMBING, not alpha. Turns the scanner's ranked
 * opportunities into a sized book:
 *
 *  - **Greedy by qtRank** (transparent — no optimizer: a 6-commodity, ~12y daily
 *    sample cannot support an estimated-covariance optimizer).
 *  - **Correlation-aware dedup**: the SIGNED exposure correlation (Pearson ρ of
 *    date-aligned Δvalues × sideA × sideB) against every already-selected position
 *    must stay ≤ corrMax — stacked same-way exposures are rejected BY NAME;
 *    offsetting exposures (signed ρ < 0) are welcome.
 *  - **Vol-target sizing**: contracts = floor(perTradeRisk / (σdaily·√H·pointValue))
 *    — every position risks ≈ the same $ over the horizon; 0 contracts ⇒ the spread
 *    is too big for the budget and is rejected, never rounded up.
 *  - Only gate-clean candidates are sizable (`gatesOk`); every skip carries a reason.
 *
 * PURE (no IO/Date). Look-ahead safety is structural: only Δvalues dated ≤ asOf
 * enter any correlation (post-asOf inputs are filtered out before use).
 */

export interface PortfolioCandidate {
  instrumentId: string;
  product: string;
  /** From the scanner: fade side (−sign zEff) / seasonal window side. */
  side: 1 | -1;
  qtRank: number;
  pointValue: number;
  /** Sample std of the trailing corrWindow daily Δvalues (≤ asOf). */
  sigmaDaily: number;
  /** Trailing daily Δvalue (≤ asOf), ascending. */
  changes: { date: string; d: number }[];
  /** All QT gates pass (only these are sizable). */
  gatesOk: boolean;
}

export interface PortfolioPosition {
  instrumentId: string;
  side: 1 | -1;
  contracts: number;
  risk$: number;
  qtRank: number;
  /** Max signed correlation against the positions selected before it (null = none measurable). */
  maxSignedCorr: number | null;
}

export interface PortfolioPlan {
  asOf: string;
  positions: PortfolioPosition[];
  /** Every skip is explained. */
  rejected: { instrumentId: string; reason: string }[];
  grossRisk$: number;
  avgPairwiseCorr: number | null;
}

const MIN_OVERLAP = 40;

/**
 * Signed exposure correlation: Pearson ρ of date-aligned Δvalues (inner join)
 * × sideA × sideB. Null when the overlap is below `minOverlap` or either series
 * is constant (ρ undefined).
 */
export function signedCorr(a: PortfolioCandidate, b: PortfolioCandidate, minOverlap = MIN_OVERLAP): number | null {
  const bBy = new Map(b.changes.map((c) => [c.date, c.d]));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of a.changes) {
    const v = bBy.get(c.date);
    if (v !== undefined) {
      xs.push(c.d);
      ys.push(v);
    }
  }
  const n = xs.length;
  if (n < minOverlap) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null; // constant Δ series — ρ undefined
  return (sxy / Math.sqrt(sxx * syy)) * a.side * b.side;
}

export function buildPortfolio(
  asOf: string,
  cs: PortfolioCandidate[],
  p: QtParams["portfolio"] & { horizonDays: number },
): PortfolioPlan {
  // Structural look-ahead guard: only Δvalues dated ≤ asOf ever enter a correlation.
  const gated = cs.map((c) => ({ ...c, changes: c.changes.filter((ch) => ch.date <= asOf) }));
  const sorted = [...gated].sort((a, b) => b.qtRank - a.qtRank);

  const positions: PortfolioPosition[] = [];
  const selected: PortfolioCandidate[] = [];
  const rejected: { instrumentId: string; reason: string }[] = [];
  const perProduct = new Map<string, number>();

  for (const c of sorted) {
    if (!c.gatesOk) {
      rejected.push({ instrumentId: c.instrumentId, reason: "QT gates failed (OU / carry / structural) — not sizable" });
      continue;
    }

    // Signed correlation against every already-selected position.
    let maxCorr: number | null = null;
    let clash: { with: string; corr: number } | null = null;
    for (const s of selected) {
      const sc = signedCorr(c, s);
      if (sc === null) continue;
      if (maxCorr === null || sc > maxCorr) maxCorr = sc;
      if (sc > p.corrMax && (clash === null || sc > clash.corr)) clash = { with: s.instrumentId, corr: sc };
    }
    if (clash) {
      rejected.push({
        instrumentId: c.instrumentId,
        reason: `correlated ${clash.corr.toFixed(2)} with ${clash.with} (cap ${p.corrMax}) — stacked exposure`,
      });
      continue;
    }

    const count = perProduct.get(c.product) ?? 0;
    if (count >= p.maxPerProduct) {
      rejected.push({ instrumentId: c.instrumentId, reason: `max ${p.maxPerProduct} position(s) per product (${c.product}) reached` });
      continue;
    }
    if (positions.length >= p.maxPositions) {
      rejected.push({ instrumentId: c.instrumentId, reason: `portfolio full (maxPositions ${p.maxPositions})` });
      continue;
    }

    if (!(c.sigmaDaily > 0)) {
      rejected.push({ instrumentId: c.instrumentId, reason: "no risk unit (σ = 0) — cannot vol-target size" });
      continue;
    }
    const unitRisk = c.sigmaDaily * Math.sqrt(p.horizonDays) * c.pointValue;
    const contracts = Math.floor(p.perTradeRisk / unitRisk);
    if (contracts === 0) {
      rejected.push({
        instrumentId: c.instrumentId,
        reason: `too big for the budget — 1 contract risks $${unitRisk.toFixed(0)} over ${p.horizonDays}d vs $${p.perTradeRisk} per-trade cap (0 contracts)`,
      });
      continue;
    }

    positions.push({
      instrumentId: c.instrumentId,
      side: c.side,
      contracts,
      risk$: Number((contracts * unitRisk).toFixed(2)),
      qtRank: c.qtRank,
      maxSignedCorr: maxCorr === null ? null : Number(maxCorr.toFixed(4)),
    });
    selected.push(c);
    perProduct.set(c.product, count + 1);
  }

  // Average signed pairwise correlation of the SELECTED book (diversification read).
  const pairwise: number[] = [];
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      const sc = signedCorr(selected[i], selected[j]);
      if (sc !== null) pairwise.push(sc);
    }
  }
  const avgPairwiseCorr = pairwise.length ? Number((pairwise.reduce((s, x) => s + x, 0) / pairwise.length).toFixed(4)) : null;
  const grossRisk$ = Number(positions.reduce((s, x) => s + x.risk$, 0).toFixed(2));

  return { asOf, positions, rejected, grossRisk$, avgPairwiseCorr };
}
