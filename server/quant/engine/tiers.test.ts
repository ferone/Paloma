import { describe, it, expect } from "vitest";
import { classifyTier } from "./tiers.js";
import { DEFAULT_CONFIG } from "./config.js";
import { Tier } from "../types/index.js";

const cfg = DEFAULT_CONFIG;

describe("classifyTier (SPEC §4.4–4.5)", () => {
  it("bands: STRONG/MODERATE/WATCH/AVOID at boundaries", () => {
    expect(classifyTier(70, 0, 0, cfg).tier).toBe(Tier.STRONG);
    expect(classifyTier(45, 0, 0, cfg).tier).toBe(Tier.MODERATE);
    expect(classifyTier(25, 0, 0, cfg).tier).toBe(Tier.WATCH);
    expect(classifyTier(24.9, 0, 0, cfg).tier).toBe(Tier.AVOID);
  });
  it("AVOID override fires when both factors < threshold, regardless of score", () => {
    const r = classifyTier(95, -0.3, -0.3, cfg);
    expect(r.tier).toBe(Tier.AVOID);
    expect(r.avoidOverride).toBe(true);
  });
  it("no override when only one factor is below threshold", () => {
    const r = classifyTier(95, -0.3, 0.1, cfg);
    expect(r.tier).toBe(Tier.STRONG);
    expect(r.avoidOverride).toBe(false);
  });
});
