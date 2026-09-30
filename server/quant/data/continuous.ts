import type { SeriesPoint } from "../types/index.js";
import { futuresProduct } from "../../../shared/universe.js";
import { businessDaysBefore, contractExpiry } from "../universe/contracts.js";
import { stitchContinuous, stitchSegments, type StitchContract, type StitchSegment } from "./stitch.js";

/**
 * Continuous c0/c1/c2 legs for a COMEX metal, stitched from SPECIFIC contracts
 * (the `contracts` + `contract_bars` tables the marketdata domain fills from
 * Databento GLBX.MDP3).
 *
 * Two rules make the series tradeable rather than merely "continuous":
 *
 * 1. ACTIVE MONTHS ONLY. Gold trades G J M Q V Z and silver H K N U Z (see
 *    `shared/universe.ts` `activeMonths`). The serial months are listed but thin,
 *    so they never enter the chain: c1 of gold in March is the June contract,
 *    not the (illiquid) May.
 *
 * 2. ROLL BEFORE DELIVERY. COMEX metals are physically delivered. First notice
 *    day (FND) is the last business day of the month BEFORE the contract month
 *    (`contractExpiry`, the CommodityFutures GC/SI rule), and First Position Day
 *    — when shorts may start declaring delivery — is two business days before
 *    FND. A long must be out before then, so a contract serves in the chain
 *    THROUGH the business day before First Position Day (= 3 business days before
 *    FND) and the next active contract takes over the following session. Trading
 *    formally continues until the 3rd-last business day of the delivery month,
 *    but that tail is delivery-period trading, not the market a spread trader uses.
 *
 * PURE (no IO, no clock): the roll schedule is calendar arithmetic, so the
 * contract picked on date d depends only on d — never on later bars.
 */

export interface RawContract {
  symbol: string;
  root: string;
  year: number;
  month: number;
  lastTrade: string | null;
  firstNotice: string | null;
}

export interface RawBar {
  symbol: string;
  date: string;
  close: number;
  volume: number | null;
  openInterest: number | null;
}

export interface PreparedContract {
  symbol: string;
  root: string;
  year: number;
  month: number;
  lastTrade: string | null;
  firstNotice: string | null;
  /** Last date the contract serves in the continuous chain (see rule 2). */
  rollDate: string;
  bars: { date: string; close: number; volume: number; openInterest: number | null }[];
}

/**
 * The last date a contract serves as a continuous leg: the business day before
 * First Position Day (3 business days before first notice). Uses the stored FND
 * when the marketdata domain recorded one, else the documented CME rule.
 */
export function rollDateFor(root: string, month: number, year: number, firstNotice?: string | null): string {
  const fnd = firstNotice ?? contractExpiry(root, month, year)?.firstNotice ?? null;
  if (fnd) return businessDaysBefore(fnd, 3);
  // Unknown product: fall back to the 20th of the prior month (conservative).
  const pm = month === 1 ? 12 : month - 1;
  const py = month === 1 ? year - 1 : year;
  return `${py}-${String(pm).padStart(2, "0")}-20`;
}

/** Filter to the product's active months, attach roll dates, and group bars. PURE. */
export function prepareContracts(root: string, contracts: RawContract[], bars: RawBar[]): PreparedContract[] {
  const product = futuresProduct(root);
  const active = new Set(product?.activeMonths ?? []);
  const barsBy = new Map<string, PreparedContract["bars"]>();
  for (const b of bars) {
    if (!Number.isFinite(b.close) || b.close <= 0) continue; // zero/undef sentinels are never prices
    const arr = barsBy.get(b.symbol);
    const row = { date: b.date, close: b.close, volume: b.volume ?? 0, openInterest: b.openInterest };
    if (arr) arr.push(row);
    else barsBy.set(b.symbol, [row]);
  }
  return contracts
    .filter((c) => c.root === root && active.has(c.month))
    .map((c) => ({
      symbol: c.symbol,
      root: c.root,
      year: c.year,
      month: c.month,
      lastTrade: c.lastTrade,
      firstNotice: c.firstNotice,
      rollDate: rollDateFor(root, c.month, c.year, c.firstNotice),
      bars: (barsBy.get(c.symbol) ?? []).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    }))
    .sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
}

function toStitch(contracts: PreparedContract[]): StitchContract[] {
  return contracts.map((c) => ({
    key: c.symbol,
    month: c.month,
    year: c.year,
    // `stitch.ts` orders by, and rolls the day after, this date.
    lastTrade: c.rollDate,
    bars: c.bars.map((b) => ({ date: b.date, close: b.close, volume: b.volume })),
  }));
}

export interface ContinuousLeg {
  rank: number;
  series: SeriesPoint[];
  /** Roll history: which real contract the leg pointed at, and when. */
  segments: StitchSegment[];
}

/** Continuous legs c0..c(maxRank) for one root. PURE. */
export function buildContinuousLegs(contracts: PreparedContract[], maxRank = 2): ContinuousLeg[] {
  const sc = toStitch(contracts);
  const out: ContinuousLeg[] = [];
  for (let r = 0; r <= maxRank; r++) out.push({ rank: r, series: stitchContinuous(sc, r), segments: stitchSegments(sc, r) });
  return out;
}

/** The contract a stitched leg pointed at on `date` (latest segment starting ≤ date). */
export function contractAt(segments: StitchSegment[], date: string): string | null {
  let hit: string | null = null;
  for (const s of segments) {
    if (s.start <= date) hit = s.key;
    else break;
  }
  return hit;
}

/**
 * Weighted N-leg combination of already-stitched legs (Σ wᵢ·valueᵢ on dates
 * present in EVERY leg — never fabricated). Volume is the summed leg volume. PURE.
 */
export function combineSeries(legs: { weight: number; series: SeriesPoint[] }[]): SeriesPoint[] {
  if (legs.length === 0) return [];
  const maps = legs.map((l) => new Map(l.series.map((p) => [p.date, p])));
  const out: SeriesPoint[] = [];
  for (const [date, first] of maps[0]) {
    let value = legs[0].weight * first.value;
    let volume = first.volume ?? 0;
    let complete = true;
    for (let i = 1; i < legs.length; i++) {
      const p = maps[i].get(date);
      if (!p) {
        complete = false;
        break;
      }
      value += legs[i].weight * p.value;
      volume += p.volume ?? 0;
    }
    if (complete) out.push({ date, value: Number(value.toFixed(6)), volume });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Quotient series a/b on common dates (the gold/silver ratio). PURE. */
export function ratioSeries(num: SeriesPoint[], den: SeriesPoint[]): SeriesPoint[] {
  const d = new Map(den.map((p) => [p.date, p]));
  const out: SeriesPoint[] = [];
  for (const p of num) {
    const q = d.get(p.date);
    if (!q || !(q.value > 0)) continue;
    out.push({ date: p.date, value: Number((p.value / q.value).toFixed(6)), volume: (p.volume ?? 0) + (q.volume ?? 0) });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
