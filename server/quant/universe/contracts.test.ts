import { describe, it, expect } from "vitest";
import { contractSymbol, monthCode, codeToMonth, contractPullWindow, contractExpiry, rawSymbolFor } from "./contracts.js";
const GLBX = "GLBX.MDP3";
const IFUS = "IFUS.IMPACT";

describe("symbology", () => {
  it("builds 1-digit raw symbols and round-trips month codes", () => {
    expect(contractSymbol("HE", 5, 2025)).toBe("HEK5");
    expect(monthCode(6)).toBe("M");
    expect(codeToMonth("Z")).toBe(12);
  });
});

describe("contractPullWindow", () => {
  it("is a tight ~10-month decade-safe slice clamped to the data range", () => {
    const w = contractPullWindow(6, 2026, "2010-06-06", "2026-12-31");
    expect(w.start).toBe("2025-09-01"); // 9 months before June
    expect(w.end).toBe("2026-07-01"); // ~1 month after
  });
});

describe("contractExpiry", () => {
  it("Live Cattle (LE) is cash-settled: last business day of the contract month, no first notice", () => {
    const e = contractExpiry("LE", 6, 2026)!;
    expect(e.cashSettled).toBe(true);
    expect(e.firstNotice).toBeNull();
    expect(e.lastTrade).toBe("2026-06-30"); // 30 Jun 2026 is a Tuesday
  });

  it("Lean Hogs (HE) is cash-settled: 10th business day, no first notice", () => {
    const e = contractExpiry("HE", 7, 2026)!;
    expect(e.cashSettled).toBe(true);
    expect(e.firstNotice).toBeNull();
    // 10th business day of Jul 2026 must be a weekday inside July.
    expect(e.lastTrade!.startsWith("2026-07-")).toBe(true);
    const dow = new Date(`${e.lastTrade}T00:00:00Z`).getUTCDay();
    expect(dow).toBeGreaterThanOrEqual(1);
    expect(dow).toBeLessThanOrEqual(5);
  });

  it("Feeder Cattle (GF) is cash-settled: last Thursday of the contract month", () => {
    const e = contractExpiry("GF", 8, 2026)!;
    expect(e.cashSettled).toBe(true);
    expect(e.firstNotice).toBeNull();
    expect(new Date(`${e.lastTrade}T00:00:00Z`).getUTCDay()).toBe(4); // Thursday
  });

  it("Corn (ZC) is physically delivered: last trade before the 15th, first notice prior month-end", () => {
    const e = contractExpiry("ZC", 12, 2025)!;
    expect(e.cashSettled).toBe(false);
    expect(e.lastTrade).toBe("2025-12-12"); // business day before the 15th (15th = Mon, 14th = Sun)
    expect(e.firstNotice).toBe("2025-11-28"); // last business day of Nov 2025 (30th = Sun)
  });

  it("rolls the first-notice month across the year boundary for a January grain contract", () => {
    const e = contractExpiry("ZS", 1, 2026)!;
    expect(e.firstNotice!.startsWith("2025-12-")).toBe(true);
  });

  it("returns null for an unknown product", () => {
    expect(contractExpiry("XX", 6, 2026)).toBeNull();
  });

  // ── Expansion complexes (fixtures hand-walked from the exchange rules) ──

  it("Gold (GC) physical: 3rd-last business day of the delivery month; FND prior month-end", () => {
    const e = contractExpiry("GC", 6, 2026)!;
    expect(e.cashSettled).toBe(false);
    expect(e.lastTrade).toBe("2026-06-26"); // Jun-30 Tue, 29 Mon, 26 Fri = 3rd-last bd
    expect(e.firstNotice).toBe("2026-05-29"); // last bd of May 2026 (31st = Sun)
  });

  it("WTI (CL) : 3 business days before the 25th of the PRIOR month", () => {
    const e = contractExpiry("CL", 12, 2025)!;
    expect(e.lastTrade).toBe("2025-11-20"); // 25 Nov Tue → 24 Mon, 21 Fri, 20 Thu
    expect(e.cashSettled).toBe(false);
  });

  it("Natural Gas (NG): 3 business days before the 1st of the delivery month", () => {
    const e = contractExpiry("NG", 1, 2026)!;
    expect(e.lastTrade).toBe("2025-12-29"); // 1 Jan Thu → 31 Wed, 30 Tue, 29 Mon
  });

  it("ULSD/RBOB (HO/RB): last business day of the month prior to delivery", () => {
    expect(contractExpiry("HO", 3, 2026)!.lastTrade).toBe("2026-02-27"); // last bd of Feb 2026 (28th = Sat)
    expect(contractExpiry("RB", 3, 2026)!.lastTrade).toBe("2026-02-27");
  });

  it("Bitcoin (BTC/MBT/ETH) cash-settled: last Friday of the contract month", () => {
    const e = contractExpiry("BTC", 3, 2026)!;
    expect(e.cashSettled).toBe(true);
    expect(e.firstNotice).toBeNull();
    expect(e.lastTrade).toBe("2026-03-27"); // Fridays in Mar 2026: 6/13/20/27
    expect(contractExpiry("MBT", 3, 2026)!.lastTrade).toBe("2026-03-27");
    expect(contractExpiry("ETH", 3, 2026)!.lastTrade).toBe("2026-03-27");
  });

  it("Softs (ICE, approximate): cocoa/coffee/sugar/cotton rules produce ordered dates", () => {
    const cc = contractExpiry("CC", 3, 2026)!; // 11 bd before last bd of Mar; FND 10 bd before first bd
    expect(cc.cashSettled).toBe(false);
    expect(cc.note).toMatch(/approx/i);
    expect(cc.firstNotice! < cc.lastTrade!).toBe(true);
    const kc = contractExpiry("KC", 3, 2026)!;
    expect(kc.firstNotice! < kc.lastTrade!).toBe(true);
    const sb = contractExpiry("SB", 3, 2026)!;
    expect(sb.lastTrade).toBe("2026-02-27"); // last bd of the month PRECEDING delivery
    expect(sb.firstNotice! > sb.lastTrade!).toBe(true); // FND = first bd after last trade
    const ct = contractExpiry("CT", 3, 2026)!;
    expect(ct.lastTrade! < "2026-03-31" && ct.lastTrade! > "2026-02-20").toBe(true);
  });
});

describe("rawSymbolFor — per-dataset contract symbology", () => {
  it("GLBX roots use the decade-safe 1-digit CME format", () => {
    expect(rawSymbolFor({ product: "GC", dataset: GLBX }, 6, 2026)).toBe("GCM6");
    expect(rawSymbolFor({ product: "CL", dataset: GLBX }, 12, 2025)).toBe("CLZ5");
  });
  it("IFUS uses the VERIFIED ICE iMpact format (padded root + FM + code + 0-padded year + !)", () => {
    expect(rawSymbolFor({ product: "CT", dataset: IFUS }, 9, 2026)).toBe("CT  FMU0026!");
    expect(rawSymbolFor({ product: "CC", dataset: IFUS }, 9, 2026)).toBe("CC  FMU0026!");
    expect(rawSymbolFor({ product: "SB", dataset: IFUS }, 10, 2026)).toBe("SB  FMV0026!");
    expect(rawSymbolFor({ product: "KC", dataset: IFUS }, 3, 2031)).toBe("KC  FMH0031!");
  });

  it("unknown datasets still throw (never guess a symbol format)", () => {
    expect(() => rawSymbolFor({ product: "CT", dataset: "IFEU.IMPACT" }, 3, 2026)).toThrow(/unverified/);
  });
});
