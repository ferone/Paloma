import type { SeriesPoint } from "../types/index.js";

/**
 * Roll-by-expiry stitching: build a CONTINUOUS c.0/c.1/c.2-style series from
 * SPECIFIC contracts — the data path for datasets with no native continuous
 * symbology (ICE IFUS.IMPACT; see scripts/probe-ice.ts evidence 2026-07-02).
 *
 * Selection rule (documented, deliberately simple): on each date `d`, order the
 * contracts whose `lastTrade ≥ d` by lastTrade ascending; rank N picks the
 * (N+1)-th. The front rolls the day AFTER its last trade — mirroring how the
 * GLBX continuous legs behave closely enough for daily-bar research, and the
 * roll history is exported as segments so leg maps name the real contract.
 *
 * LOOK-AHEAD SAFE by construction: the pick at date d depends only on d vs the
 * contracts' STATIC expiry calendar — never on any bar after d. NO FABRICATION:
 * a date where the selected contract has no bar is skipped, never interpolated.
 * PURE (no IO/Date).
 */

export interface StitchBar {
  date: string; // YYYY-MM-DD
  close: number;
  volume?: number;
}

export interface StitchContract {
  /** Stable identity for segments/leg maps (e.g. "CT-2026-03" or the raw symbol). */
  key: string;
  month: number;
  year: number;
  /** The contract's last trading day (its expiry ordering key). */
  lastTrade: string;
  bars: StitchBar[];
}

/** The contract rank N picks on date d, or null. */
function pick(contracts: StitchContract[], d: string, rank: number): StitchContract | null {
  const active = contracts.filter((c) => c.lastTrade >= d);
  active.sort((a, b) => (a.lastTrade < b.lastTrade ? -1 : a.lastTrade > b.lastTrade ? 1 : 0));
  return active[rank] ?? null;
}

/** All trading dates across the given contracts, ascending. */
function allDates(contracts: StitchContract[]): string[] {
  const set = new Set<string>();
  for (const c of contracts) for (const b of c.bars) set.add(b.date);
  return [...set].sort();
}

/** Continuous series for rank N (0 = front). */
export function stitchContinuous(contracts: StitchContract[], rank: number): SeriesPoint[] {
  const barsBy = new Map(contracts.map((c) => [c.key, new Map(c.bars.map((b) => [b.date, b]))]));
  const out: SeriesPoint[] = [];
  for (const d of allDates(contracts)) {
    const c = pick(contracts, d, rank);
    if (!c) continue;
    const bar = barsBy.get(c.key)?.get(d);
    if (!bar) continue; // selected contract didn't trade that day — skip, never fabricate
    out.push({ date: d, value: bar.close, ...(bar.volume !== undefined ? { volume: bar.volume } : {}) });
  }
  return out;
}

export interface StitchSegment {
  start: string;
  end: string;
  key: string;
}

/** Contiguous runs of the rank-N pick — the roll history for leg maps. */
export function stitchSegments(contracts: StitchContract[], rank: number): StitchSegment[] {
  const barsBy = new Map(contracts.map((c) => [c.key, new Map(c.bars.map((b) => [b.date, b]))]));
  const segs: StitchSegment[] = [];
  for (const d of allDates(contracts)) {
    const c = pick(contracts, d, rank);
    if (!c || !barsBy.get(c.key)?.has(d)) continue;
    const last = segs[segs.length - 1];
    if (last && last.key === c.key) last.end = d;
    else segs.push({ start: d, end: d, key: c.key });
  }
  return segs;
}
