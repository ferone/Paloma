import { describe, it, expect } from "vitest";
import { buildPortfolio, signedCorr, type PortfolioCandidate } from "./portfolio.js";

const P = { corrWindow: 120, corrMax: 0.6, maxPositions: 8, maxPerProduct: 2, perTradeRisk: 1000, horizonDays: 20 };

const iso = (i: number): string => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

/** Deterministic VARYING Δvalue sequence (a constant Δ has no defined correlation). */
function mkChanges(n = 60, f: (i: number) => number = (i) => ((i * 7) % 11) - 5): { date: string; d: number }[] {
  return Array.from({ length: n }, (_, i) => ({ date: iso(i), d: f(i) }));
}

function cand(over: Partial<PortfolioCandidate> = {}): PortfolioCandidate {
  return {
    instrumentId: "LE.cal.0-1",
    product: "LE",
    side: 1,
    qtRank: 90,
    pointValue: 400,
    sigmaDaily: 0.5,
    changes: mkChanges(),
    gatesOk: true,
    ...over,
  };
}

const AS_OF = iso(60); // after every fixture change date

describe("signedCorr", () => {
  it("identical Δvalues, same side ⇒ +1; opposite side ⇒ −1", () => {
    const a = cand({ instrumentId: "A" });
    const b = cand({ instrumentId: "B" });
    expect(signedCorr(a, b)).toBeCloseTo(1, 10);
    expect(signedCorr(a, cand({ instrumentId: "C", side: -1 }))).toBeCloseTo(-1, 10);
  });

  it("returns null below the overlap minimum", () => {
    const a = cand({ changes: mkChanges(20) });
    const b = cand({ changes: mkChanges(20) });
    expect(signedCorr(a, b)).toBeNull(); // 20 < 40 overlap
    expect(signedCorr(a, b, 10)).toBeCloseTo(1, 10); // explicit lower bar
  });

  it("date-aligned inner join: disjoint dates ⇒ null", () => {
    const a = cand({ changes: mkChanges(60) });
    const b = cand({ changes: mkChanges(60).map((c, i) => ({ ...c, date: iso(100 + i) })) });
    expect(signedCorr(a, b)).toBeNull();
  });
});

describe("buildPortfolio — vol-target sizing (worked example)", () => {
  it("contracts = floor(1000 / (0.5·√20·400)) = floor(1.118) = 1", () => {
    const plan = buildPortfolio(AS_OF, [cand()], P);
    expect(plan.positions).toHaveLength(1);
    expect(plan.positions[0].contracts).toBe(1);
    // risk$ = 1 · 0.5·√20·400 = 894.43
    expect(plan.positions[0].risk$).toBeCloseTo(0.5 * Math.sqrt(20) * 400, 1);
    expect(plan.grossRisk$).toBeCloseTo(plan.positions[0].risk$, 6);
  });

  it("a spread too big for the budget (0 contracts) is rejected with a reason", () => {
    const plan = buildPortfolio(AS_OF, [cand({ sigmaDaily: 100 })], P);
    expect(plan.positions).toHaveLength(0);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].reason).toMatch(/contract|budget|size/i);
  });

  it("σ = 0 cannot be sized — rejected with a reason", () => {
    const plan = buildPortfolio(AS_OF, [cand({ sigmaDaily: 0 })], P);
    expect(plan.positions).toHaveLength(0);
    expect(plan.rejected[0].reason).toMatch(/σ|risk unit/);
  });
});

describe("buildPortfolio — correlation dedup (signed)", () => {
  it("identical changes, same side: the lower-ranked twin is rejected, naming ρ and the clash", () => {
    const a = cand({ instrumentId: "LE.cal.0-1", qtRank: 90 });
    const b = cand({ instrumentId: "LE.cal.1-2", product: "HE", qtRank: 80 }); // other product: isolate the corr rule
    const plan = buildPortfolio(AS_OF, [b, a], P); // input order must not matter (greedy by rank)
    expect(plan.positions.map((p) => p.instrumentId)).toEqual(["LE.cal.0-1"]);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].instrumentId).toBe("LE.cal.1-2");
    expect(plan.rejected[0].reason).toMatch(/correlated 1\.00 with LE\.cal\.0-1/);
  });

  it("opposite sides on identical changes: signed corr −1 ⇒ ALLOWED (offsetting exposure)", () => {
    const a = cand({ instrumentId: "A", qtRank: 90 });
    const b = cand({ instrumentId: "B", product: "HE", qtRank: 80, side: -1 });
    const plan = buildPortfolio(AS_OF, [a, b], P);
    expect(plan.positions.map((p) => p.instrumentId)).toEqual(["A", "B"]);
    expect(plan.positions[1].maxSignedCorr).toBeCloseTo(-1, 10);
    expect(plan.avgPairwiseCorr).toBeCloseTo(-1, 10);
  });
});

describe("buildPortfolio — caps and gates", () => {
  it("skips !gatesOk candidates with a named reason (never silently)", () => {
    const plan = buildPortfolio(AS_OF, [cand({ gatesOk: false })], P);
    expect(plan.positions).toHaveLength(0);
    expect(plan.rejected[0].reason).toMatch(/gate/i);
  });

  it("enforces maxPerProduct (uncorrelated fixtures: disjoint dates ⇒ corr null)", () => {
    const mk = (id: string, rank: number, offset: number): PortfolioCandidate =>
      cand({ instrumentId: id, qtRank: rank, changes: mkChanges(60).map((c, i) => ({ ...c, date: iso(offset + i) })) });
    // Keep every date ≤ asOf: offsets 0/…, asOf far out.
    const asOf = iso(400);
    const plan = buildPortfolio(asOf, [mk("LE.a", 90, 0), mk("LE.b", 80, 100), mk("LE.c", 70, 200)], {
      ...P,
      maxPerProduct: 2,
    });
    expect(plan.positions.map((p) => p.instrumentId)).toEqual(["LE.a", "LE.b"]);
    expect(plan.rejected[0].instrumentId).toBe("LE.c");
    expect(plan.rejected[0].reason).toMatch(/product/i);
  });

  it("enforces maxPositions with a 'portfolio full' reason", () => {
    const asOf = iso(400);
    const mk = (id: string, product: string, rank: number, offset: number): PortfolioCandidate =>
      cand({ instrumentId: id, product, qtRank: rank, changes: mkChanges(60).map((c, i) => ({ ...c, date: iso(offset + i) })) });
    const cs = [mk("A", "LE", 90, 0), mk("B", "HE", 80, 100), mk("C", "GF", 70, 200)];
    const plan = buildPortfolio(asOf, cs, { ...P, maxPositions: 2 });
    expect(plan.positions).toHaveLength(2);
    expect(plan.rejected[0].instrumentId).toBe("C");
    expect(plan.rejected[0].reason).toMatch(/full|maxPositions/i);
  });

  it("greedy by qtRank: the highest rank is sized first regardless of input order", () => {
    const lo = cand({ instrumentId: "LO", qtRank: 10, product: "HE", changes: mkChanges(60, (i) => ((i * 5) % 7) - 3) });
    const hi = cand({ instrumentId: "HI", qtRank: 99 });
    const plan = buildPortfolio(AS_OF, [lo, hi], P);
    expect(plan.positions[0].instrumentId).toBe("HI");
  });
});

describe("buildPortfolio — look-ahead (changes after asOf are structurally ignored)", () => {
  it("appending post-asOf Δvalues never changes the plan", () => {
    const a = cand({ instrumentId: "A", qtRank: 90 });
    const b = cand({ instrumentId: "B", product: "HE", qtRank: 80 }); // identical → rejected at ρ=1
    const before = buildPortfolio(AS_OF, [a, b], P);

    // Junk future Δs that would DE-correlate the pair if they were ever read.
    const junk = Array.from({ length: 50 }, (_, i) => ({ date: iso(70 + i), d: i % 2 === 0 ? 50 : -50 }));
    const b2 = { ...b, changes: [...b.changes, ...junk] };
    const after = buildPortfolio(AS_OF, [a, b2], P);

    expect(after).toEqual(before);
    expect(after.rejected[0].reason).toMatch(/correlated 1\.00 with A/);
  });
});
