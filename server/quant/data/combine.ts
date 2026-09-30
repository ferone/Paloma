import type { SeriesPoint } from "../types/index.js";
import type { DailyBar } from "./bars.js";

/**
 * Generalize `buildSpread` to an arbitrary weighted basket of legs (outright =
 * 1 leg, calendar = +1/−1, inter-commodity / crush = N weighted legs). The
 * combined value is `Σ weightᵢ · closeᵢ` in PRICE units (point-value $ scaling
 * is applied later, when computing P&L). Only dates present in EVERY leg are
 * kept (no fabricated bars). PURE.
 */
export interface WeightedLeg {
  weight: number;
  bars: DailyBar[];
}

export function combineLegs(legs: WeightedLeg[]): SeriesPoint[] {
  if (legs.length === 0) return [];
  const maps = legs.map((l) => new Map(l.bars.map((b) => [b.date, b])));
  const out: SeriesPoint[] = [];
  for (const date of maps[0].keys()) {
    let value = 0;
    let volume = 0;
    let complete = true;
    for (let i = 0; i < legs.length; i++) {
      const bar = maps[i].get(date);
      if (!bar) {
        complete = false;
        break;
      }
      value += legs[i].weight * bar.close;
      volume += bar.volume;
    }
    if (!complete) continue;
    out.push({ date, value: Number(value.toFixed(6)), volume });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}
