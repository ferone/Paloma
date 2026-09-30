import { describe, it, expect, beforeAll } from "vitest";
import { computeQuant, type QuantResult } from "./compute.js";
import { makeFixture } from "../testing/fixture.js";
import type { MlPredictionsLite } from "../../../shared/artifacts.js";

// TEST-ONLY synthetic market: 2012 → 2024, gold + silver (+ micro gold mirror).
const gc = makeFixture({ root: "GC", startYear: 2012, endDate: "2024-06-28", spot0: 1600, vol: 0.009, seed: 101 });
const si = makeFixture({ root: "SI", startYear: 2012, endDate: "2024-06-28", spot0: 25, vol: 0.016, carry: 0.05, seed: 202 });
const mgc = makeFixture({ root: "MGC", startYear: 2012, endDate: "2024-06-28", spot0: 1600, vol: 0.009, seed: 101 });

const ml: MlPredictionsLite = {
  asOf: "2024-06-28",
  modelRunId: 1,
  predictions: [
    { instrumentId: "GC.cal.0-1", metal: "gold", horizonDays: 20, pConverge: 0.7, expectedMove: 120, validationStatus: "passed", asOf: "2024-06-28" },
    { instrumentId: "SI.cal.0-1", metal: "silver", horizonDays: 20, pConverge: 0.9, validationStatus: "failed", asOf: "2024-06-28" },
  ],
};

let res: QuantResult;
let elapsed = 0;
beforeAll(() => {
  const t0 = Date.now();
  res = computeQuant({
    roots: { GC: gc, SI: si, MGC: mgc },
    ml,
    generatedAt: "2024-06-29T06:00:00.000Z",
  });
  elapsed = Date.now() - t0;
}, 240_000);

describe("computeQuant — engine run over a synthetic multi-year fixture", () => {
  it("runs in reasonable time", () => {
    expect(elapsed).toBeLessThan(180_000);
  });

  it("reports the data horizon and engine profile", () => {
    expect(res.dataThrough).toBe("2024-06-28");
    expect(res.engine.profile).toBe("EngineQT");
    expect(res.engine.N).toBe(60);
  });

  it("analyzes every structure for both metals, symmetric", () => {
    const ids = new Set(res.instruments.map((i) => i.id));
    for (const root of ["GC", "SI", "MGC"]) for (const s of ["out", "cal.0-1", "cal.1-2", "fly.0-1-2"]) expect(ids.has(`${root}.${s}`), `${root}.${s}`).toBe(true);
    expect(ids.has("GS.ratio")).toBe(true);
    expect(ids.has("GS.spread")).toBe(true);
    expect([...ids].some((id) => id.startsWith("GC.seas."))).toBe(true);
    expect([...ids].some((id) => id.startsWith("SI.seas."))).toBe(true);
  });

  it("every instrument carries z/OU/gates/verdicts for both modes and a trade plan", () => {
    const cal = res.instruments.find((i) => i.id === "GC.cal.0-1")!;
    expect(cal.score).not.toBeNull();
    expect(cal.ou?.halfLife === null || cal.ou!.halfLife! > 0).toBe(true);
    expect(cal.carry?.regime).toBe("contango"); // fixture curve carries positive cost of carry
    expect(cal.verdicts.conservative.mode).toBe("conservative");
    expect(cal.verdicts.aggressive.mode).toBe("aggressive");
    expect(["BUY", "SELL", "AVOID"]).toContain(cal.verdicts.conservative.action);
    expect(cal.plan.legs.map((l) => l.contract)).toEqual([expect.stringMatching(/^GC[GJMQVZ]\d\d$/), expect.stringMatching(/^GC[GJMQVZ]\d\d$/)]);
    expect(cal.oos.method).toBe("seasonal-window");
    expect(cal.decision.lenses.length).toBeGreaterThan(0);
    const fly = res.instruments.find((i) => i.id === "SI.fly.0-1-2")!;
    expect(fly.oos.method).toBe("z-fade");
    expect(fly.curvature?.length).toBeGreaterThan(100);
    expect(fly.structural?.points.length).toBeGreaterThan(100);
  });

  it("a SELL/BUY verdict always names its direction; conservative never BUYs an unvalidated edge", () => {
    for (const mode of ["conservative", "aggressive"] as const) {
      for (const r of res.opportunities[mode]) {
        if (r.verdict.action !== "AVOID") {
          expect(r.verdict.direction).not.toBeNull();
          expect(r.verdict.instruction).toMatch(/^(Long|Short) /);
        }
        if (mode === "conservative" && r.verdict.decision === "BUY") expect(r.oos).toBe("passed");
      }
    }
  });

  it("scanner rows are ranked and exclude the micro mirrors", () => {
    const rows = res.opportunities.conservative;
    expect(rows.length).toBeGreaterThan(10);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].qtRank).toBeGreaterThanOrEqual(rows[i].qtRank);
    expect(rows.some((r) => r.product === "MGC")).toBe(false);
  });

  it("reads ML nudges only when validated", () => {
    const gcCal = res.opportunities.conservative.find((r) => r.id === "GC.cal.0-1")!;
    const siCal = res.opportunities.conservative.find((r) => r.id === "SI.cal.0-1")!;
    expect(gcCal.mlCounted).toBe(true);
    expect(siCal.mlCounted).toBe(false);
    expect(res.mlCounted).toBe(1);
  });

  it("seasonal pair spreads use the season-day axis with per-year curves and OOS", () => {
    const s = res.seasonality.find((x) => x.id === "GC.seas.M-Q")!;
    expect(s.originDoy).toBeGreaterThan(1);
    expect(s.perYear.length).toBeGreaterThanOrEqual(6);
    expect(s.envelope.length).toBeGreaterThan(100);
    expect(s.monthTicks).toHaveLength(12);
    const out = res.seasonality.find((x) => x.id === "GC.out")!;
    expect(out.rebase).toBe("rebasePct");
    expect(out.monthly.cells.length).toBeGreaterThan(100);
  });

  it("relative value: ratio with bands, OU and walk-forward, plus the dollar spread", () => {
    const rv = res.relativeValue!;
    expect(rv.ratio.latest).toBeGreaterThan(20);
    expect(rv.ratio.bandWindow).toBe(252);
    expect(rv.ratio.oos.method).toBe("z-fade");
    expect(rv.ratio.hedge.silverContracts).toBeGreaterThan(0);
    expect(rv.spread.volParityRatio).not.toBeNull();
    expect(rv.spread.series.length).toBeGreaterThan(1000);
  });

  it("term structure uses active months and computes annualized carry", () => {
    const c = res.curves.find((x) => x.root === "GC")!;
    expect(c.asOf).toBe("2024-06-28");
    expect(c.regime).toBe("contango");
    expect(c.points.filter((p) => p.active).length).toBeGreaterThanOrEqual(3);
    expect(c.frontCarry).toBeGreaterThan(0);
    expect(c.prior).not.toBeNull();
  });

  it("point-in-time backtests for each metal × mode, plus the QT gate ablation", () => {
    expect(res.backtests.map((b) => `${b.metal}:${b.mode}`).sort()).toEqual([
      "gold:aggressive",
      "gold:conservative",
      "silver:aggressive",
      "silver:conservative",
    ]);
    const g = res.backtests.find((b) => b.metal === "gold" && b.mode === "aggressive")!;
    expect(g.totals.decisions).toBeGreaterThan(50);
    expect(g.equity.length).toBe(g.totals.decisions);
    expect(g.histogram.reduce((s, b) => s + b.count, 0)).toBeGreaterThan(0);
    expect(res.gates.map((x) => x.metal).sort()).toEqual(["gold", "silver"]);
    expect(res.gates[0].rows.map((r) => r.gate)).toEqual(["ou", "carry"]);
  });

  it("publishes the cross-domain lite snapshot", () => {
    expect(res.lite.dataThrough).toBe("2024-06-28");
    expect(res.lite.opportunities.length).toBeGreaterThan(0);
    for (const o of res.lite.opportunities) {
      expect(["BUY", "SELL", "AVOID"]).toContain(o.verdict);
      expect(["long", "short"]).toContain(o.side);
    }
  });

  it("an empty market yields an empty (not failing) result", () => {
    const empty = computeQuant({ roots: {}, generatedAt: "2024-06-29T06:00:00.000Z", skipBacktests: true });
    expect(empty.dataThrough).toBeNull();
    expect(empty.instruments).toEqual([]);
    expect(empty.relativeValue).toBeNull();
  });
});
