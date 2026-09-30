import { describe, it, expect } from "vitest";
import { assembleDecision, type DecisionInput } from "./decision.js";

const base: DecisionInput = {
  verdict: "AVOID",
  z: 0,
  score: 0,
  avoidOverride: false,
  fundFactor: 0,
  validationStatus: "untested",
  seasonalAligned: null,
  regimeRobust: null,
  mlPConverge: null,
  mlValidated: false,
  volPercentile: null,
  ai: null,
};

describe("assembleDecision — convergence of independent lenses", () => {
  it("high conviction BUY when the independent lenses agree", () => {
    const d = assembleDecision({
      ...base,
      verdict: "BUY",
      z: -2.3,
      score: 72,
      fundFactor: 0.4,
      validationStatus: "passed",
      seasonalAligned: true,
      regimeRobust: true,
      mlPConverge: 0.64,
      mlValidated: true,
      volPercentile: 0.3,
      ai: { stance: "buy", looksLikeBuy: false, alignsWithFundamentals: true, confidence: "high", thesis: "Converges.", topRisk: "macro shock" },
    });
    expect(d.convictionLabel).toBe("high");
    expect(d.conviction).toBeGreaterThanOrEqual(70);
    expect(d.trap).toBe(false);
    expect(d.lenses.filter((l) => l.stance === "supports").length).toBeGreaterThanOrEqual(5);
    expect(d.thesis).toBe("Converges.");
    expect(d.counter).toBe("macro shock");
  });

  it("flags 'looks like a buy but isn't' — stretched z + high score but failed OOS + AI trap", () => {
    const d = assembleDecision({
      ...base,
      verdict: "AVOID",
      z: -2.1,
      score: 76,
      validationStatus: "failed",
      seasonalAligned: false,
      fundFactor: -0.3,
      ai: { stance: "avoid", looksLikeBuy: true, alignsWithFundamentals: false, confidence: "high", thesis: "Seasonal artifact.", topRisk: "no validated edge" },
    });
    expect(d.trap).toBe(true);
    expect(d.headline.toLowerCase()).toContain("looks like a buy");
    // the statistical lens "contradicts" the AVOID (it looked tradeable), the deeper lenses support it
    expect(d.lenses.find((l) => l.key === "statistical")!.stance).toBe("contradicts");
    expect(d.lenses.find((l) => l.key === "seasonal")!.stance).toBe("supports");
  });

  it("confident stand-aside: weak z + failed validation → high conviction AVOID, no trap", () => {
    const d = assembleDecision({
      ...base,
      verdict: "AVOID",
      z: 0.3,
      score: 8,
      validationStatus: "failed",
      fundFactor: -0.2,
      volPercentile: 0.9,
    });
    expect(d.trap).toBe(false); // no surface appeal (z small, score low)
    expect(d.conviction).toBeGreaterThanOrEqual(55); // lenses agree there's nothing to trade
    expect(d.verdict).toBe("AVOID");
  });

  it("absent lenses are handled gracefully (null inputs → no crash, neutral-ish)", () => {
    const d = assembleDecision({ ...base, verdict: "AVOID", z: null, score: null });
    expect(d.lenses.some((l) => l.stance === "absent")).toBe(true);
    expect(Number.isFinite(d.conviction)).toBe(true);
    expect(d.headline.length).toBeGreaterThan(0);
  });

  it("AI 'looksLikeBuy' contributes a contradicting news lens on a non-BUY verdict", () => {
    const d = assembleDecision({
      ...base,
      verdict: "AVOID",
      z: -1.8,
      score: 60,
      ai: { stance: "avoid", looksLikeBuy: true, alignsWithFundamentals: false, confidence: "moderate", thesis: "x", topRisk: "y" },
    });
    // looksLikeBuy ⇒ the news vote is "con" (no trade) ⇒ on an AVOID that SUPPORTS standing aside
    expect(d.lenses.find((l) => l.key === "news")!.stance).toBe("supports");
    expect(d.trap).toBe(true);
  });
});
