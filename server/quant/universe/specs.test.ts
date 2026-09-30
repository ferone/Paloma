import { describe, it, expect } from "vitest";
import { SPECS, getSpec } from "./specs.js";
import { monthCode } from "./contracts.js";
import { UNIVERSE } from "../../../shared/universe.js";

describe("SPECS — metals", () => {
  const entries = Object.entries(SPECS);

  it("covers every futures root in shared/universe.ts", () => {
    const roots = [...UNIVERSE.gold.futures, ...UNIVERSE.silver.futures].map((f) => f.root).sort();
    expect(Object.keys(SPECS).sort()).toEqual(roots);
  });

  it("tickValue == tickSize × pointValue for every spec (no unit trap)", () => {
    for (const [p, s] of entries) expect(s.tickValue, `${p} tickValue`).toBeCloseTo(s.tickSize * s.pointValue, 6);
  });

  it("monthCodes match the ACTIVE months", () => {
    expect(SPECS.GC.monthCodes).toBe("G J M Q V Z");
    expect(SPECS.SI.monthCodes).toBe("H K N U Z");
    for (const [p, s] of entries) expect(s.monthCodes, p).toBe(s.months.map((m) => monthCode(m)).join(" "));
  });

  it("pins the $-meter per product", () => {
    expect(SPECS.GC.pointValue).toBe(100);
    expect(SPECS.MGC.pointValue).toBe(10);
    expect(SPECS.SI.pointValue).toBe(5000);
    expect(SPECS.SIL.pointValue).toBe(1000);
  });

  it("getSpec resolves roots and contract symbols", () => {
    expect(getSpec("GCZ26")?.product).toBe("GC");
    expect(getSpec("MGCG27")?.product).toBe("MGC");
    expect(getSpec("SIH7")?.product).toBe("SI");
    expect(getSpec("XX")).toBeUndefined();
  });
});
