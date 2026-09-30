import { describe, it, expect } from "vitest";
import type { SeriesPoint } from "../types/index.js";
import { monthlyReturns } from "./monthlyReturns.js";

const iso = (y: number, m: number, d: number): string =>
  `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;

/**
 * Build a positive (price-like) series: one bar per day, the LAST bar of each
 * month set to `endClose(year, month)`. Intermediate days carry a noise value so
 * the "last close in month" logic is exercised.
 */
function priceSeries(
  endClose: (year: number, month: number) => number,
  years: number[],
  months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const y of years) {
    for (const m of months) {
      // a few intermediate days then the month-end close
      out.push({ date: iso(y, m, 5), value: 1 }); // noise — must be ignored
      out.push({ date: iso(y, m, 15), value: 2 }); // noise — must be ignored
      out.push({ date: iso(y, m, 28), value: endClose(y, m) });
    }
  }
  return out;
}

describe("monthlyReturns — pct basis (strictly positive series)", () => {
  it("computes close-to-close month total return as WHOLE-NUMBER percent", () => {
    // month-end closes: 100,110,121 across Jan,Feb,Mar of 2020 → +10% each step
    const closes: Record<string, number> = {
      "2020-1": 100,
      "2020-2": 110,
      "2020-3": 121,
    };
    const s = priceSeries((y, m) => closes[`${y}-${m}`], [2020], [1, 2, 3]);
    const mat = monthlyReturns(s);
    expect(mat.basis).toBe("pct");

    const cell = (year: number, month: number) =>
      mat.cells.find((c) => c.year === year && c.month === month);

    // first month overall is null (no previous month)
    expect(cell(2020, 1)!.ret).toBeNull();
    // Feb: 100 -> 110 = +10%
    expect(cell(2020, 2)!.ret).toBeCloseTo(10, 9);
    // Mar: 110 -> 121 = +10%
    expect(cell(2020, 3)!.ret).toBeCloseTo(10, 9);
    // whole-number percent convention: 10 not 0.10
    expect(cell(2020, 2)!.ret).toBeGreaterThan(1);
    expect(cell(2020, 2)!.basis).toBe("pct");
  });

  it("returns 5 (not 0.05) for a +5% move — whole-number percent", () => {
    const closes: Record<string, number> = { "2021-1": 200, "2021-2": 210 };
    const s = priceSeries((y, m) => closes[`${y}-${m}`], [2021], [1, 2]);
    const mat = monthlyReturns(s);
    const feb = mat.cells.find((c) => c.year === 2021 && c.month === 2)!;
    expect(feb.ret).toBeCloseTo(5, 9);
  });

  it("uses the LAST close in a month, ignoring intra-month noise", () => {
    // both months end at the same close → 0% return regardless of noise days
    const s = priceSeries(() => 50, [2020], [1, 2]);
    const mat = monthlyReturns(s);
    const feb = mat.cells.find((c) => c.year === 2020 && c.month === 2)!;
    expect(feb.ret).toBeCloseTo(0, 9);
  });

  it("crosses the calendar year boundary (Dec -> next Jan)", () => {
    const closes: Record<string, number> = {
      "2020-12": 100,
      "2021-1": 120,
    };
    const s = priceSeries((y, m) => closes[`${y}-${m}`], [], []);
    // build the two months manually
    const manual: SeriesPoint[] = [
      { date: iso(2020, 12, 28), value: 100 },
      { date: iso(2021, 1, 28), value: 120 },
    ];
    void s;
    const mat = monthlyReturns(manual);
    const jan = mat.cells.find((c) => c.year === 2021 && c.month === 1)!;
    expect(jan.ret).toBeCloseTo(20, 9); // 100 -> 120 = +20%
    const dec = mat.cells.find((c) => c.year === 2020 && c.month === 12)!;
    expect(dec.ret).toBeNull(); // first month overall
  });
});

describe("monthlyReturns — abs basis (spread series straddling zero)", () => {
  it("switches the WHOLE matrix to abs change when the series crosses zero", () => {
    // values range from -5 to +5 → percent is ill-defined → abs basis
    const closes: Record<string, number> = {
      "2020-1": -5,
      "2020-2": 0,
      "2020-3": 5,
    };
    const s = priceSeries((y, m) => closes[`${y}-${m}`], [2020], [1, 2, 3]);
    const mat = monthlyReturns(s);
    expect(mat.basis).toBe("abs");

    const cell = (month: number) => mat.cells.find((c) => c.year === 2020 && c.month === month)!;
    expect(cell(1).ret).toBeNull();
    // Feb: -5 -> 0 = +5 (absolute change)
    expect(cell(2).ret).toBeCloseTo(5, 9);
    expect(cell(2).basis).toBe("abs");
    // Mar: 0 -> 5 = +5
    expect(cell(3).ret).toBeCloseTo(5, 9);
  });
});

describe("monthlyReturns — monthSummary aggregation", () => {
  it("aggregates each calendar month across years (whole-number percent)", () => {
    // Feb return = +10% every year; Mar return = -10% every year.
    // Jan is the first month of each year (has a prior Dec only for years after the first).
    const closes: Record<string, number> = {};
    for (const y of [2020, 2021, 2022]) {
      closes[`${y}-1`] = 100;
      closes[`${y}-2`] = 110; // +10% Jan->Feb
      closes[`${y}-3`] = 99; // 110 -> 99 = -10% Feb->Mar
    }
    const s = priceSeries((y, m) => closes[`${y}-${m}`], [2020, 2021, 2022], [1, 2, 3]);
    const mat = monthlyReturns(s);

    const sumOf = (month: number) => mat.monthSummary.find((x) => x.month === month)!;

    const feb = sumOf(2);
    expect(feb.avg).toBeCloseTo(10, 6);
    expect(feb.median).toBeCloseTo(10, 6);
    expect(feb.best).toBeCloseTo(10, 6);
    expect(feb.worst).toBeCloseTo(10, 6);
    expect(feb.pctPositive).toBeCloseTo(100, 6);
    expect(feb.pctNegative).toBeCloseTo(0, 6);

    const mar = sumOf(3);
    expect(mar.avg).toBeCloseTo(-10, 6);
    expect(mar.pctPositive).toBeCloseTo(0, 6);
    expect(mar.pctNegative).toBeCloseTo(100, 6);
  });

  it("mixes positive and negative Febs → correct pctPositive", () => {
    // 2021 Feb up +10, 2022 Feb down. (2020 Jan is overall-first so Jan->Feb of 2020 still counts.)
    const closes: Record<string, number> = {
      "2020-1": 100,
      "2020-2": 110, // +10%
      "2021-1": 100,
      "2021-2": 110, // +10%
      "2022-1": 100,
      "2022-2": 90, // -10%
    };
    const s = priceSeries((y, m) => closes[`${y}-${m}`], [2020, 2021, 2022], [1, 2]);
    const mat = monthlyReturns(s);
    const feb = mat.monthSummary.find((x) => x.month === 2)!;
    // 3 Feb observations: +10, +10, -10 → 2/3 positive
    expect(feb.pctPositive).toBeCloseTo((2 / 3) * 100, 6);
    expect(feb.pctNegative).toBeCloseTo((1 / 3) * 100, 6);
    expect(feb.best).toBeCloseTo(10, 6);
    expect(feb.worst).toBeCloseTo(-10, 6);
  });
});

describe("monthlyReturns — structure", () => {
  it("exposes sorted unique years and months 1..12 present", () => {
    const s = priceSeries((y, m) => 100 + m, [2022, 2020, 2021]);
    const mat = monthlyReturns(s);
    expect(mat.years).toEqual([2020, 2021, 2022]);
    expect(mat.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("returns empty structure for empty input", () => {
    const mat = monthlyReturns([]);
    expect(mat.years).toEqual([]);
    expect(mat.cells).toEqual([]);
    expect(mat.monthSummary).toEqual([]);
  });
});

describe("monthlyReturns — LOOK-AHEAD INVARIANT", () => {
  it("appending a future YEAR leaves all prior cells byte-identical", () => {
    const base = priceSeries((y, m) => 100 + (y - 2020) * 12 + m, [2018, 2019, 2020]);
    const withFuture = priceSeries(
      (y, m) => 100 + (y - 2020) * 12 + m,
      [2018, 2019, 2020, 2021, 2022],
    );

    const baseMat = monthlyReturns(base);
    const fullMat = monthlyReturns(withFuture);

    // every cell present in baseMat must be identical in fullMat
    for (const c of baseMat.cells) {
      const f = fullMat.cells.find((x) => x.year === c.year && x.month === c.month)!;
      expect(f).toBeDefined();
      expect(f.ret).toBe(c.ret); // exact, not close — byte-identical
      expect(f.basis).toBe(c.basis);
    }
  });

  it("monthSummary for already-complete months is unchanged by future years", () => {
    // construct so every year's Feb return is exactly +10% and basis is pct in both runs
    const f = (y: number, m: number) => (m === 1 ? 100 : m === 2 ? 110 : 100 + m);
    const base = priceSeries(f, [2018, 2019, 2020]);
    const withFuture = priceSeries(f, [2018, 2019, 2020, 2021, 2022]);

    const baseFeb = monthlyReturns(base).monthSummary.find((x) => x.month === 2)!;
    const fullFeb = monthlyReturns(withFuture).monthSummary.find((x) => x.month === 2)!;

    // Feb return is +10% every year, so the aggregate is invariant to adding more +10% years
    expect(fullFeb.avg).toBeCloseTo(baseFeb.avg, 9);
    expect(fullFeb.median).toBeCloseTo(baseFeb.median, 9);
    expect(fullFeb.best).toBeCloseTo(baseFeb.best, 9);
    expect(fullFeb.worst).toBeCloseTo(baseFeb.worst, 9);
    expect(fullFeb.pctPositive).toBeCloseTo(baseFeb.pctPositive, 9);
  });

  it("truncate-back equivalence: slicing the future year off reproduces the matrix", () => {
    const f = (y: number, m: number) => 100 + (y - 2018) * 5 + m * 0.5;
    const years = [2018, 2019, 2020, 2021];
    const full = priceSeries(f, years);
    // bars belonging to the last year, removed
    const truncated = full.filter((p) => Number(p.date.slice(0, 4)) < 2021);

    const direct = monthlyReturns(truncated);
    const fromFull = monthlyReturns(full);

    for (const c of direct.cells) {
      const g = fromFull.cells.find((x) => x.year === c.year && x.month === c.month)!;
      expect(g.ret).toBe(c.ret);
    }
  });
});
