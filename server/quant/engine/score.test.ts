import { describe, it, expect } from "vitest";
import { scoreAsOf } from "./score.js";
import { DEFAULT_CONFIG } from "./config.js";
import { MR_CONFIG, QT_CONFIG } from "./profiles.js";
import type { AsOfView, PricePoint } from "../types/index.js";

// A deterministic, mean-reverting-ish spread series with enough history for N=60.
const prices: PricePoint[] = Array.from({ length: 200 }, (_, i) => ({
  date: new Date(Date.UTC(2022, 0, 1 + i)).toISOString().slice(0, 10),
  spread: 100 + Math.sin(i / 9) * 4 + (i % 2 ? 0.5 : -0.5),
}));
const view: AsOfView = { asOf: prices[prices.length - 1].date, prices, funds: [] };

describe("scoreAsOf — engine tag (v3 byte-identical regression)", () => {
  it("v3 (default) produces a row with NO `engine` key", () => {
    const row = scoreAsOf("LE.cal.0-1", view, DEFAULT_CONFIG)!;
    expect(row).not.toBeNull();
    expect("engine" in row).toBe(false);
    expect(row.configVersion).toBe(3);
  });

  it("passing engine='v3' explicitly is identical to the default (still no key)", () => {
    const def = scoreAsOf("LE.cal.0-1", view, DEFAULT_CONFIG);
    const v3 = scoreAsOf("LE.cal.0-1", view, DEFAULT_CONFIG, "v3");
    expect(v3).toEqual(def);
    expect("engine" in (v3 as object)).toBe(false);
  });

  it("a non-default engine STAMPS its id but leaves the scoring fields driven only by config", () => {
    // Same config object, only the engine tag differs → every scoring field equal,
    // plus an `engine` key. (Proves the tag never touches the math.)
    const a = scoreAsOf("LE.cal.0-1", view, DEFAULT_CONFIG)!;
    const b = scoreAsOf("LE.cal.0-1", view, DEFAULT_CONFIG, "mr")!;
    const { engine, ...bNoEngine } = b;
    expect(engine).toBe("mr");
    expect(bNoEngine).toEqual(a);
  });

  it("MR_CONFIG stamps its own version lineage (1) alongside engine='mr'", () => {
    const row = scoreAsOf("LE.cal.0-1", view, MR_CONFIG, "mr")!;
    expect(row.engine).toBe("mr");
    expect(row.configVersion).toBe(1);
  });

  it("QT_CONFIG stamps engine='qt' + version 1; the qt param block never touches the core math", () => {
    const row = scoreAsOf("LE.cal.0-1", view, QT_CONFIG, "qt")!;
    // QT_CONFIG shares v3's scoring knobs, so every scoring field matches the
    // default row (the qt block is DOWNSTREAM-only — plugins, never the score).
    const a = scoreAsOf("LE.cal.0-1", view, DEFAULT_CONFIG)!;
    const { engine, configVersion, ...rest } = row;
    const { configVersion: defaultVersion, ...restA } = a;
    expect(engine).toBe("qt");
    expect(configVersion).toBe(1);
    expect(defaultVersion).toBe(3);
    expect(rest).toEqual(restA);
  });
});
