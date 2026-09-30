import { describe, it, expect } from "vitest";
import { weeksToExpiry, annotateByExpiryWeek, expiryWeekAverage } from "./expiryAxis.js";
import type { SeriesPoint } from "../types/index.js";

describe("expiry-week alignment (EngineMR #3)", () => {
  it("weeksToExpiry: 0 in the expiry week, positive before, negative after", () => {
    expect(weeksToExpiry("2026-06-19", "2026-06-19")).toBe(0);
    expect(weeksToExpiry("2026-06-05", "2026-06-19")).toBe(2); // 14 days = 2 weeks
    expect(weeksToExpiry("2026-06-26", "2026-06-19")).toBe(-1); // a week after
  });

  it("annotateByExpiryWeek re-indexes onto weeks-to-expiry and drops null-expiry points", () => {
    const series: SeriesPoint[] = [
      { date: "2026-06-05", value: 10 },
      { date: "2026-06-12", value: 11 },
      { date: "2026-06-19", value: 12 },
      { date: "2026-07-01", value: 99 }, // no expiry → dropped
    ];
    const expiryOf = (d: string) => (d <= "2026-06-19" ? "2026-06-19" : null);
    const ann = annotateByExpiryWeek(series, expiryOf);
    expect(ann.map((a) => a.week)).toEqual([2, 1, 0]);
    expect(ann.length).toBe(3);
  });

  it("expiryWeekAverage buckets across years by weeks-to-expiry", () => {
    // Two 'years' both expiring on a Friday; week-2 values 10 & 20 → mean 15.
    const ann = annotateByExpiryWeek(
      [
        { date: "2025-06-06", value: 10 },
        { date: "2026-06-05", value: 20 },
      ],
      (d) => (d.startsWith("2025") ? "2025-06-20" : "2026-06-19"),
    );
    const avg = expiryWeekAverage(ann);
    const w2 = avg.find((x) => x.week === 2)!;
    expect(w2.mean).toBe(15);
    expect(w2.n).toBe(2);
  });

  it("INVARIANT: a prefix's mapping is independent of later bars (look-ahead-safe)", () => {
    const expiryOf = () => "2026-06-19";
    const full: SeriesPoint[] = [
      { date: "2026-06-01", value: 1 },
      { date: "2026-06-08", value: 2 },
      { date: "2026-06-15", value: 3 },
    ];
    const a = annotateByExpiryWeek(full.slice(0, 2), expiryOf);
    const b = annotateByExpiryWeek(full, expiryOf).slice(0, 2);
    expect(a).toEqual(b);
  });
});
