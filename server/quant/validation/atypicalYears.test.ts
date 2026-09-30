import { describe, it, expect } from "vitest";
import { atypicalYearsFromRegimes } from "./atypicalYears.js";
import { excludeSeasonYears } from "../seasonality/exclude.js";
import type { SeriesPoint } from "../types/index.js";

// A monthly series spanning 2017..2022 with a HUGE benign spike in 2019 (a
// genuinely NON-regime year for metals — COVID-EFP 2020, the silver squeeze 2021).
const series: SeriesPoint[] = [];
for (let y = 2017; y <= 2022; y++) {
  for (let m = 1; m <= 12; m++) {
    const spike = y === 2019 && m === 6 ? 9999 : 100; // price anomaly in a NON-regime year
    series.push({ date: `${y}-${String(m).padStart(2, "0")}-15`, value: spike });
  }
}

describe("atypical-year removal (EngineMR #6) — exogenous-only", () => {
  it("flags 2020 via the COVID-EFP window, NOT 2019 (the price spike)", () => {
    const yrs = atypicalYearsFromRegimes(series);
    expect(yrs.has(2020)).toBe(true);
    expect(yrs.has(2019)).toBe(false); // the 2019 price spike is NOT a declared shock → kept
  });

  it("flags 2021 (the silver squeeze) and leaves calm 2017/2018/2022 alone", () => {
    const yrs = atypicalYearsFromRegimes(series);
    expect(yrs.has(2021)).toBe(true);
    for (const y of [2017, 2018, 2022]) expect(yrs.has(y)).toBe(false);
  });

  it("only flags years actually present in the series", () => {
    const short = series.filter((p) => p.date.startsWith("2017")); // 2017 is in no window
    const yrs = atypicalYearsFromRegimes(short);
    expect(yrs.size).toBe(0);
  });

  it("excludeSeasonYears removes exactly the flagged years (and keeps the 2019 spike)", () => {
    const yrs = atypicalYearsFromRegimes(series);
    const kept = excludeSeasonYears(series, yrs);
    const keptYears = new Set(kept.map((p) => Number(p.date.slice(0, 4))));
    expect(keptYears.has(2020)).toBe(false); // removed (exogenous)
    expect(keptYears.has(2019)).toBe(true); // kept (price spike is not a reason to remove)
    expect(kept.some((p) => p.value === 9999)).toBe(true); // the spike survives — no circular removal
  });

  it("INVARIANT: the excluded set is frozen ex-ante (independent of as-of / later data)", () => {
    const prefix = series.filter((p) => p.date <= "2020-12-31");
    const onPrefix = atypicalYearsFromRegimes(prefix);
    expect(onPrefix.has(2020)).toBe(true);
  });
});
