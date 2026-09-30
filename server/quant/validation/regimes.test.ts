import { describe, it, expect } from "vitest";
import { regimeOf, regimeRobustness, regimesFor, REGIME_WINDOWS } from "./regimes.js";
import type { WalkForwardResult, OosTrade } from "./walkForward.js";
import { performance } from "./metrics.js";

const trade = (year: number, entryDoy: number, netPnl: number): OosTrade => ({
  year,
  entryDoy,
  exitDoy: entryDoy + 20,
  side: "long",
  grossPnl: netPnl,
  netPnl,
});

const wfOf = (trades: OosTrade[]): WalkForwardResult => {
  const m = performance(trades.map((t) => t.netPnl));
  const status = m.trades >= 3 && m.winRate >= 0.6 && m.avgPnl > 0 && Math.abs(m.tStat) >= 1.5 ? "passed" : "failed";
  return { trades, metrics: m, validationStatus: status, reason: "" };
};

describe("regimeOf (precious-metals shock windows)", () => {
  it("flags dates inside a shock window and clears dates outside", () => {
    expect(regimeOf("2020-04-15")).toBe("COVID-EFP");
    expect(regimeOf("2011-05-02")).toBe("Silver-2011");
    expect(regimeOf("2013-04-15")).toBe("Taper-2013");
    expect(regimeOf("2021-02-01")).toBe("Silver-Squeeze-2021");
    expect(regimeOf("2025-01-15")).toBe("Tariff-EFP-2025");
    expect(regimeOf("2025-10-10")).toBe("London-Squeeze-2025");
    expect(regimeOf("2017-05-01")).toBeNull(); // calm year
    expect(regimeOf("2024-05-01")).toBeNull();
  });

  it("windows are well-formed, disjoint and ISO-dated", () => {
    const sorted = [...REGIME_WINDOWS].sort((a, b) => (a.start < b.start ? -1 : 1));
    for (let i = 0; i < sorted.length; i++) {
      const w = sorted[i];
      expect(w.start < w.end).toBe(true);
      expect(w.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (i > 0) expect(sorted[i - 1].end < w.start).toBe(true);
    }
  });

  it("every metal root and relative-value id resolves to the metal list", () => {
    for (const id of ["GC", "SI.cal.0-1", "MGC.out", "SIL.fly.0-1-2", "GS.ratio"]) expect(regimesFor(id)).toBe(REGIME_WINDOWS);
  });
});

describe("regimeRobustness", () => {
  it("an edge built ONLY on calm years survives (nothing excluded)", () => {
    const wf = wfOf([trade(2015, 100, 300), trade(2016, 100, 280), trade(2017, 100, 320), trade(2023, 100, 290)]);
    const r = regimeRobustness(wf);
    expect(r.excludedTrades).toBe(0);
    expect(r.fullStatus).toBe("passed");
    expect(r.survives).toBe(true);
  });

  it("an edge whose OOS sample is mostly shock years cannot be confirmed out-of-regime", () => {
    // Passes full (5 consistent wins) but 3 of the 5 trades entered in shock windows,
    // so only 2 calm years remain — below the 3-trade floor → cannot confirm.
    const wf = wfOf([
      trade(2017, 100, 200), // calm
      trade(2011, 130, 210), // May-2011 → Silver-2011
      trade(2013, 105, 205), // mid-Apr-2013 → Taper-2013
      trade(2020, 110, 215), // Apr-2020 → COVID-EFP
      trade(2023, 100, 195), // calm
    ]);
    const r = regimeRobustness(wf);
    expect(r.fullStatus).toBe("passed");
    expect(r.regimesHit.sort()).toEqual(["COVID-EFP", "Silver-2011", "Taper-2013"]);
    expect(r.excludedTrades).toBe(3);
    expect(r.exRegimeStatus).toBe("untested");
    expect(r.survives).toBe(false);
  });
});
