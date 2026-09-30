import { describe, it, expect } from "vitest";
import { stitchContinuous, stitchSegments, type StitchContract } from "./stitch.js";

/**
 * Roll-by-expiry stitching fixtures. Two cotton-style contracts:
 *  - H26 (lastTrade 2026-03-09) and K26 (lastTrade 2026-05-06).
 * Before H26's lastTrade: c.0 = H26, c.1 = K26. After: c.0 = K26.
 */
const H26: StitchContract = {
  key: "CT-2026-03",
  month: 3,
  year: 2026,
  lastTrade: "2026-03-09",
  bars: [
    { date: "2026-03-06", close: 70.1, volume: 100 },
    { date: "2026-03-09", close: 70.5, volume: 90 },
  ],
};
const K26: StitchContract = {
  key: "CT-2026-05",
  month: 5,
  year: 2026,
  lastTrade: "2026-05-06",
  bars: [
    { date: "2026-03-06", close: 71.0, volume: 60 },
    { date: "2026-03-09", close: 71.4, volume: 55 },
    { date: "2026-03-10", close: 71.6, volume: 80 },
  ],
};
const N26: StitchContract = {
  key: "CT-2026-07",
  month: 7,
  year: 2026,
  lastTrade: "2026-07-08",
  bars: [
    { date: "2026-03-06", close: 72.0 },
    { date: "2026-03-09", close: 72.3 },
    { date: "2026-03-10", close: 72.5 },
  ],
};

describe("stitchContinuous — expiry-ordered rank selection per date", () => {
  it("rank 0 holds the front until its lastTrade, then rolls to the next", () => {
    const c0 = stitchContinuous([H26, K26, N26], 0);
    expect(c0).toEqual([
      { date: "2026-03-06", value: 70.1, volume: 100 },
      { date: "2026-03-09", value: 70.5, volume: 90 }, // lastTrade day: still the front
      { date: "2026-03-10", value: 71.6, volume: 80 }, // rolled to K26
    ]);
  });

  it("rank 1 tracks the second-nearest unexpired contract", () => {
    const c1 = stitchContinuous([H26, K26, N26], 1);
    expect(c1.map((p) => p.value)).toEqual([71.0, 71.4, 72.5]);
  });

  it("a date where the selected contract has no bar is SKIPPED (no fabrication)", () => {
    const gappy: StitchContract = { ...K26, bars: K26.bars.filter((b) => b.date !== "2026-03-10") };
    const c0 = stitchContinuous([H26, gappy], 0);
    expect(c0.map((p) => p.date)).toEqual(["2026-03-06", "2026-03-09"]);
  });

  it("rank beyond the available unexpired contracts yields nothing for that date", () => {
    const c2 = stitchContinuous([H26, K26], 2);
    expect(c2).toEqual([]);
  });

  it("LOOK-AHEAD: selection at date d uses only d vs static lastTrade (append-invariant)", () => {
    const before = stitchContinuous([H26, K26], 0);
    const withFuture: StitchContract = {
      key: "CT-2026-12",
      month: 12,
      year: 2026,
      lastTrade: "2026-12-08",
      bars: [{ date: "2026-11-02", close: 99 }],
    };
    const after = stitchContinuous([H26, K26, withFuture], 0).filter((p) => p.date <= "2026-03-10");
    expect(after).toEqual(before);
  });
});

describe("stitchSegments — the roll history for leg maps", () => {
  it("emits one segment per contiguous front contract", () => {
    const segs = stitchSegments([H26, K26, N26], 0);
    expect(segs).toEqual([
      { start: "2026-03-06", end: "2026-03-09", key: "CT-2026-03" },
      { start: "2026-03-10", end: "2026-03-10", key: "CT-2026-05" },
    ]);
  });
});
