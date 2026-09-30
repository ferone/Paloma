import type { SeriesPoint, YearCurve } from "../types/index.js";
import { annotate, byYear } from "./util.js";

export type RebaseMode = "absolute" | "rebaseZero" | "rebasePct";

/**
 * Per-calendar-year paths indexed by day-of-year, for overlay charts (each
 * year's line faint, the average bold). Rebasing makes years comparable:
 *  - "absolute"  : raw values
 *  - "rebaseZero": subtract the year's first value (start at 0)
 *  - "rebasePct" : percent change from the year's first value
 * PURE.
 */
export function perYearCurves(series: SeriesPoint[], rebase: RebaseMode = "rebaseZero", originDoy = 1): YearCurve[] {
  const groups = byYear(annotate(series, originDoy));
  const out: YearCurve[] = [];
  for (const [year, pts] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (pts.length === 0) continue;
    const base = pts[0].value;
    const points = pts.map((p) => {
      let value = p.value;
      if (rebase === "rebaseZero") value = p.value - base;
      else if (rebase === "rebasePct") value = base !== 0 ? (p.value / base - 1) * 100 : 0;
      return { doy: p.doy, value };
    });
    out.push({ year, points });
  }
  return out;
}
