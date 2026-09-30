import { describe, it, expect } from "vitest";
import {
  decideVerdict,
  decideSeasonalVerdict,
  liveVerdictWindow,
  verdictAction,
  type VerdictInput,
  type PersistedWindow,
} from "./verdict.js";
import { DEFAULT_CONFIG } from "./config.js";

const base: VerdictInput = {
  signal: { z: 1.8, score: 60, avoidOverride: false },
  validationStatus: "passed",
  seasonal: { active: true, agrees: true },
  ml: null,
};

describe("decideVerdict", () => {
  it("conservative: BUY when validated + score≥MODERATE + no override + seasonality agrees", () => {
    const r = decideVerdict(base, "conservative", DEFAULT_CONFIG);
    expect(r.verdict).toBe("BUY");
    expect(r.reasons.some((x) => /OOS-validated/i.test(x))).toBe(true);
    expect(r.blockers).toHaveLength(0);
  });

  it("a failed-OOS high score is AVOID in conservative but BUY in aggressive", () => {
    const input: VerdictInput = { signal: { z: 1.9, score: 60, avoidOverride: false }, validationStatus: "failed", seasonal: null };
    const cons = decideVerdict(input, "conservative", DEFAULT_CONFIG);
    expect(cons.verdict).toBe("AVOID");
    expect(cons.blockers.some((x) => /not OOS-validated/i.test(x))).toBe(true);

    const aggr = decideVerdict(input, "aggressive", DEFAULT_CONFIG);
    expect(aggr.verdict).toBe("BUY");
    // OOS status is surfaced as context, not a blocker, in aggressive mode.
    expect(aggr.reasons.some((x) => /OOS: failed/i.test(x))).toBe(true);
  });

  it("AVOID override forces AVOID in BOTH modes regardless of score", () => {
    const input: VerdictInput = { signal: { z: 2.5, score: 85, avoidOverride: true }, validationStatus: "passed" };
    for (const mode of ["conservative", "aggressive"] as const) {
      const r = decideVerdict(input, mode, DEFAULT_CONFIG);
      expect(r.verdict).toBe("AVOID");
      expect(r.blockers.some((x) => /AVOID override/i.test(x))).toBe(true);
    }
  });

  it("conservative: an active seasonal window that CONFLICTS blocks the BUY", () => {
    const input: VerdictInput = { ...base, seasonal: { active: true, agrees: false } };
    const r = decideVerdict(input, "conservative", DEFAULT_CONFIG);
    expect(r.verdict).toBe("AVOID");
    expect(r.blockers.some((x) => /conflicts/i.test(x))).toBe(true);
  });

  it("aggressive: a sub-WATCH score is AVOID", () => {
    const input: VerdictInput = { signal: { z: 0.3, score: 10, avoidOverride: false }, validationStatus: "untested", seasonal: null };
    const r = decideVerdict(input, "aggressive", DEFAULT_CONFIG);
    expect(r.verdict).toBe("AVOID");
    expect(r.blockers.some((x) => /below WATCH/i.test(x))).toBe(true);
  });

  it("confidence is high for a validated, strong-tier conservative BUY", () => {
    const input: VerdictInput = { signal: { z: 2.4, score: 82, avoidOverride: false }, validationStatus: "passed", seasonal: { active: false, agrees: false } };
    const r = decideVerdict(input, "conservative", DEFAULT_CONFIG);
    expect(r.verdict).toBe("BUY");
    expect(r.confidence).toBe("high");
  });
});

// The single source of truth the home cards and the instrument detail page share
// so they cannot disagree at the live date. The LE.seas.M-Q edge is DOY 131–161.
describe("liveVerdictWindow", () => {
  const LE_EDGE: PersistedWindow = { entryDoy: 131, exitDoy: 161, side: "long" };

  it("seasonal: outside the validated edge window → not in-window (drives AVOID)", () => {
    const lw = liveVerdictWindow("seasonal", 169, LE_EDGE, null, null);
    expect(lw.seasonalInWindow).toBe(false);
    expect(lw.win).toEqual({ entryDoy: 131, exitDoy: 161, side: "long" });
    expect(lw.windowSide).toBe("long");
    expect(lw.convSeasonal).toBeNull();
    // wired through the decision layer: a validated edge but outside → conservative AVOID.
    const v = decideSeasonalVerdict({ validationStatus: "passed", inWindow: lw.seasonalInWindow, windowSide: lw.windowSide }, "conservative");
    expect(v.verdict).toBe("AVOID");
  });

  it("seasonal: inside the validated edge window → in-window (validated → BUY)", () => {
    const lw = liveVerdictWindow("seasonal", 150, LE_EDGE, null, null);
    expect(lw.seasonalInWindow).toBe(true);
    const v = decideSeasonalVerdict({ validationStatus: "passed", inWindow: lw.seasonalInWindow, windowSide: lw.windowSide }, "conservative");
    expect(v.verdict).toBe("BUY");
  });

  it("convergence: a present opportunity window is active; aligned drives the gate", () => {
    const oppWin: PersistedWindow = { entryDoy: 100, exitDoy: 200, side: "short" };
    const conflict = liveVerdictWindow("calendar", 150, null, oppWin, false);
    expect(conflict.convSeasonal).toEqual({ active: true, agrees: false });
    expect(conflict.win).toEqual({ entryDoy: 100, exitDoy: 200, side: "short" });
    expect(conflict.seasonalInWindow).toBe(false);
    // an active CONFLICTING window blocks a conservative convergence BUY.
    const blocked = decideVerdict(
      { signal: { z: 1.8, score: 60, avoidOverride: false }, validationStatus: "passed", seasonal: conflict.convSeasonal },
      "conservative",
      DEFAULT_CONFIG,
    );
    expect(blocked.verdict).toBe("AVOID");

    const agree = liveVerdictWindow("calendar", 150, null, oppWin, true);
    expect(agree.convSeasonal).toEqual({ active: true, agrees: true });
  });

  it("no persisted window → null win, no seasonal field (verdict falls back to other gates)", () => {
    const seasonalNone = liveVerdictWindow("seasonal", 150, null, null, null);
    expect(seasonalNone.win).toBeNull();
    expect(seasonalNone.seasonalInWindow).toBe(false);

    const convNone = liveVerdictWindow("calendar", 150, null, null, null);
    expect(convNone.win).toBeNull();
    expect(convNone.convSeasonal).toBeNull();
  });
});

// A BUY can be a long OR a short trade; the UI must say which. verdictAction recasts
// the decision so "BUY" = go long, "SELL" = go short, "AVOID" = stand aside.
describe("verdictAction", () => {
  it("BUY + long → BUY (go long the spread)", () => {
    expect(verdictAction("BUY", "long")).toBe("BUY");
  });
  it("BUY + short → SELL (go short the spread)", () => {
    expect(verdictAction("BUY", "short")).toBe("SELL");
  });
  it("BUY + unknown direction → BUY (default long)", () => {
    expect(verdictAction("BUY", null)).toBe("BUY");
  });
  it("AVOID is AVOID regardless of direction", () => {
    expect(verdictAction("AVOID", "long")).toBe("AVOID");
    expect(verdictAction("AVOID", "short")).toBe("AVOID");
    expect(verdictAction("AVOID", null)).toBe("AVOID");
  });
});

describe("verdict — regime-robustness gate (anomaly-driven edges are not a conservative BUY)", () => {
  it("seasonal: passed + in-window but regime-FRAGILE → conservative AVOID (the HE.seas.M-N case)", () => {
    const fragile = decideSeasonalVerdict(
      { validationStatus: "passed", inWindow: true, windowSide: "long", survivesRegime: false },
      "conservative",
    );
    expect(fragile.verdict).toBe("AVOID");
    expect(fragile.blockers.some((b) => /regime-FRAGILE/i.test(b))).toBe(true);
  });

  it("seasonal: passed + in-window + regime-ROBUST → conservative BUY (unchanged)", () => {
    const robust = decideSeasonalVerdict(
      { validationStatus: "passed", inWindow: true, windowSide: "long", survivesRegime: true },
      "conservative",
    );
    expect(robust.verdict).toBe("BUY");
  });

  it("seasonal: survivesRegime undefined → no effect (back-compat: still BUY)", () => {
    const legacy = decideSeasonalVerdict({ validationStatus: "passed", inWindow: true, windowSide: "long" }, "conservative");
    expect(legacy.verdict).toBe("BUY");
  });

  it("convergence: a regime-fragile passed edge is not a conservative BUY", () => {
    const v = decideVerdict(
      { signal: { z: 1.8, score: 60, avoidOverride: false }, validationStatus: "passed", seasonal: null, ml: null, survivesRegime: false },
      "conservative",
      DEFAULT_CONFIG,
    );
    expect(v.verdict).toBe("AVOID");
    expect(v.blockers.some((b) => /regime-FRAGILE/i.test(b))).toBe(true);
  });
});

describe("verdict — regime-OFF filter (don't trade into a structural move; EngineMR #6 risk half)", () => {
  const base = { signal: { z: 1.8, score: 60, avoidOverride: false }, validationStatus: "passed" as const, seasonal: null, ml: null };
  it("a regime-OFF (current structural move) period blocks a conservative BUY", () => {
    const v = decideVerdict({ ...base, regimeOff: true }, "conservative", DEFAULT_CONFIG);
    expect(v.verdict).toBe("AVOID");
    expect(v.blockers.some((b) => /regime-OFF/i.test(b))).toBe(true);
  });
  it("regimeOff undefined/false leaves a qualifying BUY intact", () => {
    expect(decideVerdict({ ...base }, "conservative", DEFAULT_CONFIG).verdict).toBe("BUY");
    expect(decideVerdict({ ...base, regimeOff: false }, "conservative", DEFAULT_CONFIG).verdict).toBe("BUY");
  });
  it("aggressive mode ignores regimeOff (acts on the live signal)", () => {
    expect(decideVerdict({ ...base, regimeOff: true }, "aggressive", DEFAULT_CONFIG).verdict).toBe("BUY");
  });
});

describe("verdict — EngineQT gates (OU tradability + carry trend veto)", () => {
  const base = { signal: { z: 1.8, score: 60, avoidOverride: false }, validationStatus: "passed" as const, seasonal: null, ml: null };

  it("BYTE-IDENTITY: inputs without the QT fields decide exactly as before", () => {
    const v = decideVerdict({ ...base }, "conservative", DEFAULT_CONFIG);
    // Pinned regression snapshot of the pre-QT behavior for this input.
    expect(v.verdict).toBe("BUY");
    expect(v.blockers).toEqual([]);
    expect(v.confidence).toBe("medium");
    // Explicit undefined is the same as absent.
    const v2 = decideVerdict({ ...base, ouTradable: undefined, carryConflict: undefined }, "conservative", DEFAULT_CONFIG);
    expect(v2).toEqual(v);
  });

  it("ouTradable=false blocks a conservative BUY (no reversion structure)", () => {
    const v = decideVerdict({ ...base, ouTradable: false }, "conservative", DEFAULT_CONFIG);
    expect(v.verdict).toBe("AVOID");
    expect(v.blockers.some((b) => /mean-reversion structure|OU half-life/i.test(b))).toBe(true);
  });

  it("carryConflict=true blocks a conservative BUY (don't fade a trending curve)", () => {
    const v = decideVerdict({ ...base, carryConflict: true }, "conservative", DEFAULT_CONFIG);
    expect(v.verdict).toBe("AVOID");
    expect(v.blockers.some((b) => /carry veto|trending curve/i.test(b))).toBe(true);
  });

  it("ouTradable=true is a stated reason; both-good leaves the BUY intact", () => {
    const v = decideVerdict({ ...base, ouTradable: true, carryConflict: false }, "conservative", DEFAULT_CONFIG);
    expect(v.verdict).toBe("BUY");
    expect(v.reasons.some((r) => /OU half-life/i.test(r))).toBe(true);
  });

  it("aggressive mode treats the QT flags as context only (never blockers)", () => {
    const v = decideVerdict({ ...base, ouTradable: false, carryConflict: true }, "aggressive", DEFAULT_CONFIG);
    expect(v.verdict).toBe("BUY");
    expect(v.blockers.some((b) => /OU|carry/i.test(b))).toBe(false);
  });
});
