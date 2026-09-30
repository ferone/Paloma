import { describe, it, expect } from "vitest";
import type { SeriesPoint } from "../types/index.js";
import { seasonalAverage } from "./seasonalAverage.js";
import { seasonalEnvelope } from "./envelope.js";
import { perYearCurves } from "./perYear.js";
import { seasonalWindowStats } from "./windowStats.js";
import { findSeasonalWindows } from "./findWindows.js";
import { winPnlHeatmap } from "./heatmap.js";
import { annotate, seasonOriginDoy, seasonDayOf, seasonYearOf, byYear } from "./util.js";
import { isYearCrossingSeasonal } from "../universe/seasonal.js";

// Deterministic fixture: for each year, value = doy * 0.1 (strictly rising,
// identical seasonal shape every year) over doy 1..120.
const iso = (year: number, doy: number): string =>
  new Date(Date.UTC(year, 0, doy)).toISOString().slice(0, 10);

function fixture(years: number[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const y of years) {
    for (let doy = 1; doy <= 120; doy++) out.push({ date: iso(y, doy), value: doy * 0.1 });
  }
  return out;
}

const series = fixture([2020, 2021, 2022]);

describe("seasonalAverage", () => {
  it("averages identical yearly shapes back to that shape", () => {
    const c = seasonalAverage(series, null);
    expect(c.years).toEqual([2020, 2021, 2022]);
    expect(c.values[32]).toBeCloseTo(3.2, 6); // doy 32 → 3.2 every year
    expect(c.values[60]).toBeCloseTo(6.0, 6);
  });

  it("LOOK-AHEAD: asOf bounds included years (future year ignored)", () => {
    const withFuture = [...series, ...fixture([2023])];
    const base = seasonalAverage(series, null);
    const gated = seasonalAverage(withFuture, null, "2022-12-31");
    expect(gated.years).toEqual([2020, 2021, 2022]);
    expect(gated.values[32]).toBeCloseTo(base.values[32], 9);
  });

  it("lookbackYears restricts the window", () => {
    const c = seasonalAverage(series, 1, "2022-06-01");
    expect(c.years).toEqual([2022]);
  });
});

describe("seasonalEnvelope", () => {
  it("collapses to a point when every year is identical", () => {
    const env = seasonalEnvelope(series, [10, 50, 90]);
    expect(env.bands[10][32]).toBeCloseTo(3.2, 6);
    expect(env.bands[90][32]).toBeCloseTo(3.2, 6);
  });
});

describe("perYearCurves", () => {
  it("rebases each year to start at zero", () => {
    const curves = perYearCurves(series, "rebaseZero");
    expect(curves).toHaveLength(3);
    const first = curves[0].points[0];
    expect(first.value).toBeCloseTo(0, 6); // doy 1 rebased
    const atDoy32 = curves[0].points.find((p) => p.doy === 32)!;
    expect(atDoy32.value).toBeCloseTo(3.1, 6); // 3.2 - 0.1
  });
});

describe("seasonalWindowStats", () => {
  it("computes a 100%-win long window with correct P&L and excursions", () => {
    const s = seasonalWindowStats(series, 32, 60, { side: "long", pointValue: 10 });
    expect(s.years).toBe(3);
    expect(s.winRate).toBe(1);
    expect(s.avgPnl).toBeCloseTo(28, 1); // (6.0-3.2)*10
    expect(s.avgMae).toBeCloseTo(0, 6); // monotonic up → no adverse excursion
    expect(s.avgMfe).toBeCloseTo(28, 1);
    expect(s.profitFactor).toBe(999); // no losing years → capped
    expect(s.perYear).toHaveLength(3);
  });

  it("a short of the same window loses every year", () => {
    const s = seasonalWindowStats(series, 32, 60, { side: "short", pointValue: 10 });
    expect(s.winRate).toBe(0);
    expect(s.avgPnl).toBeCloseTo(-28, 1);
  });
});

describe("findSeasonalWindows", () => {
  it("surfaces high win-rate windows on a strongly seasonal series", () => {
    const found = findSeasonalWindows(series, { minWinRate: 0.99, minYears: 3, entryStep: 10 });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((w) => w.winRate >= 0.99 && w.years >= 3)).toBe(true);
  });
});

describe("winPnlHeatmap", () => {
  it("produces a grid of winRate/avgPnl over entry × duration", () => {
    const h = winPnlHeatmap(series, { entryStep: 30, durations: [20, 40], minYears: 3 });
    expect(h.entryDoys.length).toBeGreaterThan(0);
    expect(h.winRate.length).toBe(h.entryDoys.length);
    expect(h.winRate[0].length).toBe(2);
  });
});

// ── Year-crossing "season day" re-index ──────────────────────────────────────
// A wrap fixture: data only in Dec(Y) (doy 336..365) + Jan–Feb(Y+1) (doy 1..59),
// i.e. a Dec→Feb spread. The off-season (Mar–Nov) is the big gap.
function wrapFixture(cohortYears: number[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const y of cohortYears) {
    for (let doy = 336; doy <= 365; doy++) out.push({ date: iso(y, doy), value: 1 });
    for (let doy = 1; doy <= 59; doy++) out.push({ date: iso(y + 1, doy), value: 2 });
  }
  return out;
}

describe("season-day re-index (year-crossing spreads)", () => {
  it("default originDoy = 1 is a TRUE no-op (existing specs unchanged)", () => {
    expect(annotate(series)).toEqual(annotate(series, 1));
    expect(seasonalAverage(series, null)).toEqual(seasonalAverage(series, null, undefined, 1));
    expect(seasonDayOf("2022-03-15")).toBe(seasonDayOf("2022-03-15", 1));
    expect(seasonYearOf("2022-03-15")).toBe(2022);
  });

  it("seasonOriginDoy finds the first present day after the off-season gap", () => {
    const wrap = wrapFixture([2018, 2019, 2020]);
    expect(seasonOriginDoy(wrap)).toBe(336); // first December day after the Mar–Nov gap
  });

  it("re-indexing makes each wrap cohort ONE contiguous season-year", () => {
    const wrap = wrapFixture([2018, 2019, 2020]);
    const origin = seasonOriginDoy(wrap);
    const grouped = byYear(annotate(wrap, origin));
    // 3 cohorts, each labelled by the season's START year (Dec(Y) + Jan–Feb(Y+1) → Y).
    expect([...grouped.keys()].sort((a, b) => a - b)).toEqual([2018, 2019, 2020]);
    const c2018 = grouped.get(2018)!;
    // Dec 2018 and Feb 2019 fall in the SAME cohort, with strictly increasing season-day.
    expect(c2018.some((p) => p.date.startsWith("2018-12"))).toBe(true);
    expect(c2018.some((p) => p.date.startsWith("2019-02"))).toBe(true);
    for (let i = 1; i < c2018.length; i++) expect(c2018[i].doy).toBeGreaterThan(c2018[i - 1].doy);
  });

  it("isYearCrossingSeasonal flags wrap ids only", () => {
    expect(isYearCrossingSeasonal("LE.seas.Z-G")).toBe(true); // Dec→Feb
    expect(isYearCrossingSeasonal("GF.seas.X-F")).toBe(true); // Nov→Jan
    expect(isYearCrossingSeasonal("LE.seas.M-Q")).toBe(false); // Jun→Aug
    expect(isYearCrossingSeasonal("LE.cal.0-1")).toBe(false);
  });
});
