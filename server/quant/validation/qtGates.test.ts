import { describe, it, expect } from "vitest";
import { ablateGates, type GateDecision } from "./qtGates.js";

/** Decision-array builder; dates default OUTSIDE every tracked shock window. */
function dec(
  pnl: number,
  opts: { date?: string; ouTradable?: boolean; carryConflict?: boolean } = {},
): GateDecision {
  return {
    date: opts.date ?? "2016-05-10",
    instrumentId: "LE.cal.0-1",
    pnl,
    ouTradable: opts.ouTradable ?? true,
    carryConflict: opts.carryConflict ?? false,
  };
}

describe("ablateGates — exact uplift arithmetic", () => {
  it("a gate that removes exactly the negative-PnL half HELPS, with uplift = kept.avg − all.avg", () => {
    const decisions: GateDecision[] = [
      ...Array.from({ length: 20 }, () => dec(100, { ouTradable: true })),
      ...Array.from({ length: 20 }, () => dec(-100, { ouTradable: false })),
    ];
    const [ou, carry] = ablateGates(decisions);

    expect(ou.gate).toBe("ou");
    expect(ou.kept.trades).toBe(20);
    expect(ou.removed.trades).toBe(20);
    expect(ou.all.trades).toBe(40);
    expect(ou.kept.avgPnl).toBeCloseTo(100, 6);
    expect(ou.removed.avgPnl).toBeCloseTo(-100, 6);
    expect(ou.all.avgPnl).toBeCloseTo(0, 6);
    expect(ou.upliftPerTrade).toBeCloseTo(100, 6); // kept 100 − all 0
    expect(ou.exShock.upliftPerTrade).toBeCloseTo(100, 6); // no shock dates in the fixture
    expect(ou.verdict).toBe("helps");

    // The carry gate removes nothing here → fewer than 10 removed → insufficient.
    expect(carry.gate).toBe("carry");
    expect(carry.removed.trades).toBe(0);
    expect(carry.verdict).toBe("insufficient");
  });

  it("uniform PnL ⇒ zero uplift ⇒ neutral", () => {
    const decisions: GateDecision[] = [
      ...Array.from({ length: 20 }, () => dec(50, { carryConflict: false })),
      ...Array.from({ length: 15 }, () => dec(50, { carryConflict: true })),
    ];
    const carry = ablateGates(decisions).find((g) => g.gate === "carry")!;
    expect(carry.upliftPerTrade).toBeCloseTo(0, 6);
    expect(carry.verdict).toBe("neutral");
  });

  it("a gate that removes the WINNERS hurts", () => {
    const decisions: GateDecision[] = [
      ...Array.from({ length: 20 }, () => dec(-100, { ouTradable: true })),
      ...Array.from({ length: 20 }, () => dec(100, { ouTradable: false })),
    ];
    const ou = ablateGates(decisions).find((g) => g.gate === "ou")!;
    expect(ou.upliftPerTrade).toBeCloseTo(-100, 6);
    expect(ou.verdict).toBe("hurts");
  });

  it("too few decisions ⇒ insufficient (< minDecisions)", () => {
    const decisions = [dec(100), dec(-50, { ouTradable: false }), dec(20), dec(-10, { ouTradable: false }), dec(5)];
    for (const g of ablateGates(decisions)) expect(g.verdict).toBe("insufficient");
  });

  it("fewer than 10 removed ⇒ insufficient even with plenty of decisions", () => {
    const decisions: GateDecision[] = [
      ...Array.from({ length: 35 }, () => dec(10)),
      ...Array.from({ length: 5 }, () => dec(-100, { ouTradable: false })),
    ];
    const ou = ablateGates(decisions).find((g) => g.gate === "ou")!;
    expect(ou.verdict).toBe("insufficient");
  });

  it("shock-dated wins flip a 'helps' to 'neutral' via the ex-shock check", () => {
    // Full sample: kept avg = (15·200 + 10·(−50))/25 = 100 vs all avg 66.25 ⇒ helps…
    // …but every kept WIN sits inside the COVID window; ex-shock the kept set is
    // NEGATIVE while the removed trades are mildly positive ⇒ the uplift was
    // anomaly-driven ⇒ NOT "helps" (and full uplift > 0 ⇒ not "hurts") ⇒ neutral.
    const decisions: GateDecision[] = [
      ...Array.from({ length: 15 }, () => dec(200, { date: "2020-04-15", ouTradable: true })), // COVID window
      ...Array.from({ length: 10 }, () => dec(-50, { date: "2016-05-10", ouTradable: true })),
      ...Array.from({ length: 15 }, () => dec(10, { date: "2016-06-10", ouTradable: false })),
    ];
    const ou = ablateGates(decisions).find((g) => g.gate === "ou")!;
    expect(ou.upliftPerTrade).toBeGreaterThan(0);
    expect(ou.exShock.keptAvg).toBeCloseTo(-50, 6);
    expect(ou.exShock.upliftPerTrade).toBeLessThan(0);
    expect(ou.verdict).toBe("neutral");
  });
});
