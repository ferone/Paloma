import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "./config.js";
import { ENGINE_PROFILES, MR_CONFIG, QT_CONFIG, altEngineFor, getProfile, isEngine } from "./profiles.js";

describe("engine profiles", () => {
  it("defaults to v3 for unknown/missing ids", () => {
    expect(getProfile(undefined).id).toBe("v3");
    expect(getProfile(null).id).toBe("v3");
    expect(getProfile("nope").id).toBe("v3");
    expect(getProfile("V3").id).toBe("v3"); // case-sensitive guard → falls back
  });

  it("resolves the mr profile and turns its plug-ins on", () => {
    const mr = getProfile("mr");
    expect(mr.id).toBe("mr");
    expect(mr.plugins.flies).toBe(true);
    expect(mr.plugins.convergenceBands).toBe(true);
    expect(mr.alignmentMode).toBe("expiry-week");
    // The QT plug-ins stay OFF for mr (additive, never retroactive).
    expect(mr.plugins.ouAdaptive).toBe(false);
    expect(mr.plugins.carryCurve).toBe(false);
    expect(mr.plugins.qtScanner).toBe(false);
    expect(mr.plugins.portfolio).toBe(false);
  });

  it("v3 profile is the untouched DEFAULT_CONFIG with NO plug-ins", () => {
    const v3 = getProfile("v3");
    expect(v3.config).toBe(DEFAULT_CONFIG); // same reference — not a copy/mutation
    expect(Object.values(v3.plugins).every((on) => on === false)).toBe(true);
    expect(v3.alignmentMode).toBe("continuous");
  });

  it("MR_CONFIG has its OWN version lineage (1) and does not mutate DEFAULT_CONFIG", () => {
    expect(MR_CONFIG.version).toBe(1);
    expect(DEFAULT_CONFIG.version).toBe(3); // unchanged
    expect(MR_CONFIG).not.toBe(DEFAULT_CONFIG); // distinct object
  });

  it("resolves the qt profile: OU + carry + scanner + portfolio on, MR-identity lenses off", () => {
    const qt = getProfile("qt");
    expect(qt.id).toBe("qt");
    expect(qt.alignmentMode).toBe("continuous");
    // QT analytics on:
    expect(qt.plugins.ouAdaptive).toBe(true);
    expect(qt.plugins.carryCurve).toBe(true);
    expect(qt.plugins.qtScanner).toBe(true);
    expect(qt.plugins.portfolio).toBe(true);
    // Shared risk-discipline plumbing reused from MR:
    expect(qt.plugins.flies).toBe(true);
    expect(qt.plugins.syntheticLiquidity).toBe(true);
    expect(qt.plugins.batchSettle).toBe(true);
    expect(qt.plugins.atypicalRemoval).toBe(true);
    // MR-identity lenses stay off:
    expect(qt.plugins.expiryWeekAlign).toBe(false);
    expect(qt.plugins.convergenceBands).toBe(false);
    expect(qt.plugins.kpiHorizons).toBe(false);
  });

  it("QT_CONFIG: own version lineage (1) + the qt param block; v3/mr serializations unchanged", () => {
    expect(QT_CONFIG.version).toBe(1);
    expect(QT_CONFIG.qt).toBeDefined();
    expect(QT_CONFIG.qt!.ou.halfLifeMin).toBeGreaterThan(0);
    expect(QT_CONFIG.qt!.ou.halfLifeMax).toBeGreaterThan(QT_CONFIG.qt!.ou.halfLifeMin);
    // BYTE-IDENTITY GUARD: the optional `qt` key must be ABSENT from the
    // committed configs, so their persisted JSON does not change at all.
    expect(JSON.stringify(DEFAULT_CONFIG)).not.toContain('"qt"');
    expect(JSON.stringify(MR_CONFIG)).not.toContain('"qt"');
  });

  it("isEngine type-guards the known ids only", () => {
    expect(isEngine("v3")).toBe(true);
    expect(isEngine("mr")).toBe(true);
    expect(isEngine("qt")).toBe(true);
    expect(isEngine("xx")).toBe(false);
    expect(isEngine(undefined)).toBe(false);
  });

  it("altEngineFor: v3 compares against the newest profile; others against v3", () => {
    expect(altEngineFor("v3")).toBe("qt");
    expect(altEngineFor("mr")).toBe("v3");
    expect(altEngineFor("qt")).toBe("v3");
  });

  it("registry is keyed by id (v3 listed first as the default)", () => {
    expect(Object.keys(ENGINE_PROFILES)).toEqual(["v3", "mr", "qt"]);
    expect(ENGINE_PROFILES.v3.id).toBe("v3");
    expect(ENGINE_PROFILES.mr.id).toBe("mr");
    expect(ENGINE_PROFILES.qt.id).toBe("qt");
    // Every profile carries a short pill label for the switcher.
    expect(ENGINE_PROFILES.v3.shortLabel).toBe("v3");
    expect(ENGINE_PROFILES.mr.shortLabel).toBe("MR");
    expect(ENGINE_PROFILES.qt.shortLabel).toBe("QT");
  });
});
