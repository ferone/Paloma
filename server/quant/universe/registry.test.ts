import { describe, it, expect } from "vitest";
import { REGISTRY, allSymbols, allRoots, getInstrument } from "./registry.js";
import { SPECS } from "./specs.js";

const byId = new Map(REGISTRY.map((i) => [i.id, i]));

describe("registry — gold and silver, symmetric", () => {
  it("every futures root has out / cal.0-1 / cal.1-2 / fly.0-1-2 at the SPECS pointValue", () => {
    for (const root of ["GC", "MGC", "SI", "SIL"]) {
      for (const suffix of ["out", "cal.0-1", "cal.1-2", "fly.0-1-2"]) {
        const inst = byId.get(`${root}.${suffix}`);
        expect(inst, `${root}.${suffix}`).toBeDefined();
        expect(inst!.pointValue).toBe(SPECS[root].pointValue);
        expect(inst!.dataset).toBe("GLBX.MDP3");
      }
      expect(byId.get(`${root}.cal.0-1`)!.legs.map((l) => l.weight)).toEqual([1, -1]);
      expect(byId.get(`${root}.cal.1-2`)!.legs.map((l) => l.symbol)).toEqual([`${root}.c.1`, `${root}.c.2`]);
      expect(byId.get(`${root}.fly.0-1-2`)!.legs.map((l) => l.weight)).toEqual([1, -2, 1]);
    }
  });

  it("attributes each instrument to its metal", () => {
    expect(getInstrument("GC.out")?.metal).toBe("gold");
    expect(getInstrument("SIL.fly.0-1-2")?.metal).toBe("silver");
  });

  it("relative-value instruments: ratio (quotient) + $-absorbed dollar spread", () => {
    const ratio = getInstrument("GS.ratio")!;
    expect(ratio.kind).toBe("ratio");
    expect(ratio.legs.map((l) => l.symbol)).toEqual(["GC.c.0", "SI.c.0"]);
    const spread = getInstrument("GS.spread")!;
    expect(spread.kind).toBe("inter");
    expect(spread.pointValue).toBe(1);
    expect(spread.legs.map((l) => l.weight)).toEqual([100, -5000]);
  });

  it("metals run price-only (no fundamentals wired)", () => {
    for (const inst of REGISTRY) expect(inst.fundamentals ?? []).toEqual([]);
  });

  it("allSymbols has no duplicates; roots are the four COMEX products", () => {
    const symbols = allSymbols();
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(allRoots().sort()).toEqual(["GC", "MGC", "SI", "SIL"]);
  });
});
