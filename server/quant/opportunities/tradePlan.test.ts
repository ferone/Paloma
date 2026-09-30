import { describe, it, expect } from "vitest";
import { buildTradePlan } from "./tradePlan.js";

describe("buildTradePlan", () => {
  it("long: expected $ = (target − entry)·pv; stop below entry; R:R from OOS DD", () => {
    const p = buildTradePlan({ direction: "long", entry: 1.0, target: 2.0, pointValue: 400, sd: 0.5, oosMaxDrawdown: -800, oosAvgPnl: 300, oosWinRate: 0.7 });
    expect(p.side).toBe(1);
    expect(p.expected$).toBe(400); // (2-1)*400
    expect(p.risk$).toBe(800); // |maxDD|
    expect(p.stop).toBeCloseTo(1 - 800 / 400, 6); // entry − risk/pv = -1
    expect(p.rr).toBe(0.5); // 400/800
    expect(p.winRate).toBe(0.7);
  });

  it("short: expected $ positive when target below entry; stop above entry", () => {
    const p = buildTradePlan({ direction: "short", entry: 2.0, target: 1.0, pointValue: 400, sd: 0.5 });
    expect(p.side).toBe(-1);
    expect(p.expected$).toBe(400); // -1*(1-2)*400
    // no OOS DD → band risk = 2σ·pv = 2*0.5*400 = 400; stop above entry for a short
    expect(p.risk$).toBe(400);
    expect(p.stop).toBeCloseTo(2 + 1, 6); // entry − side*(risk/pv) = 2 − (−1)*1 = 3
  });

  it("AVOID / no direction → side 0, expected 0, no stop", () => {
    const p = buildTradePlan({ direction: null, entry: 1, target: 2, pointValue: 400 });
    expect(p.side).toBe(0);
    expect(p.expected$).toBe(0);
    expect(p.stop).toBeNull();
    expect(p.rr).toBeNull();
  });

  it("entry zone brackets the entry by ±0.5σ", () => {
    const p = buildTradePlan({ direction: "long", entry: 10, target: 12, pointValue: 50, sd: 2 });
    expect(p.entryZone).toEqual([9, 11]);
  });
});
