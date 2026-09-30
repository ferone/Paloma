import { contractExpiry } from "../universe/contracts.js";
import { buildContinuousLegs, contractAt, type PreparedContract } from "./continuous.js";

/**
 * Cash-and-carry basis of a CASH-SETTLED future against its spot series,
 * compared with a cash benchmark (the 13-week T-bill). PURE (no IO, no clock).
 *
 *   basis   = (F / S − 1) × 365 / daysToLastTrade        annualized, fraction
 *   excess  = basis − T-bill                              long spot / short future over cash
 *
 * F is the FRONT contract's close from the same roll the continuous series uses
 * (`data/continuous.ts`: cash-settled contracts hand over `CASH_ROLL_BDAYS`
 * business days before last trade), so the basis and the engine's `<root>.c.0`
 * leg always name the same contract. S is the spot close for the same date and
 * the day count is calendar days to that contract's last trade.
 *
 * Near expiry the annualization explodes (a $10 gap one day out is 3,650%/yr of
 * noise), so dates with ≤ `minDays` calendar days left are skipped. With the
 * standard 5-business-day roll the front never gets that close; the guard
 * covers holiday-shortened calendars and stored last-trade dates that differ
 * from the rule.
 */

/** Dates with this many calendar days (or fewer) to the front's last trade are skipped. */
export const BASIS_MIN_DAYS = 3;
/** A T-bill print older than this many calendar days is stale: the date is skipped rather than guessed. */
export const RATE_MAX_STALE_DAYS = 7;

export interface FrontQuote {
  date: string;
  close: number;
  volume: number;
  /** Contract the front leg pointed at on `date`. */
  contract: string;
  lastTrade: string | null;
}

export interface DailyClose {
  date: string;
  close: number;
}

export interface BasisPoint {
  date: string;
  contract: string;
  lastTrade: string;
  daysToExpiry: number;
  spot: number;
  future: number;
  volume: number;
  /** Annualized basis (fraction: 0.052 = 5.2%/yr). */
  basis: number;
  /** Cash benchmark (fraction). */
  tbill: number;
  /** basis − tbill (fraction). */
  excess: number;
}

export interface BasisSeries {
  points: BasisPoint[];
  /** Dates skipped for being within `minDays` of expiry. */
  excluded: number;
  /** Dates skipped for a missing spot close or a stale/missing T-bill. */
  unmatched: number;
}

const DAY_MS = 86_400_000;

/** Calendar days from `a` to `b` (ISO dates). */
export function calendarDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** (F/S − 1) × 365 / days — the annualized basis as a fraction. NaN when undefined. */
export function annualizedBasis(future: number, spot: number, days: number): number {
  if (!(spot > 0) || !(future > 0) || !(days > 0)) return NaN;
  return ((future / spot - 1) * 365) / days;
}

/**
 * The front contract's close on every date, using the continuous-series roll
 * (the same stitching as `<root>.c.0`), with the contract it came from.
 */
export function frontContractQuotes(prepared: PreparedContract[]): FrontQuote[] {
  const [leg] = buildContinuousLegs(prepared, 0);
  const bySymbol = new Map(prepared.map((c) => [c.symbol, c]));
  const out: FrontQuote[] = [];
  for (const p of leg.series) {
    const symbol = contractAt(leg.segments, p.date);
    const c = symbol ? bySymbol.get(symbol) : undefined;
    if (!c) continue;
    const lastTrade = c.lastTrade ?? contractExpiry(c.root, c.month, c.year)?.lastTrade ?? null;
    out.push({ date: p.date, close: p.value, volume: p.volume ?? 0, contract: c.symbol, lastTrade });
  }
  return out;
}

/** Latest close on or before each requested date, tolerating `maxStaleDays` of gap. */
function asOfLookup(rows: DailyClose[], maxStaleDays: number): (date: string) => number | null {
  const sorted = [...rows].filter((r) => Number.isFinite(r.close)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return (date) => {
    let lo = 0;
    let hi = sorted.length - 1;
    let hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].date <= date) {
        hit = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (hit < 0 || calendarDays(sorted[hit].date, date) > maxStaleDays) return null;
    return sorted[hit].close;
  };
}

/**
 * Join front futures, spot and the T-bill (quoted in percent, e.g. ^IRX 4.12)
 * into the annualized basis and excess-carry series. Spot must match the date
 * exactly (the spot series trades every day); the T-bill is carried forward over
 * its own holidays, up to `RATE_MAX_STALE_DAYS`.
 */
export function buildBasisSeries(
  front: FrontQuote[],
  spot: DailyClose[],
  rate: DailyClose[],
  opts: { minDays?: number; maxRateStaleDays?: number } = {},
): BasisSeries {
  const minDays = opts.minDays ?? BASIS_MIN_DAYS;
  const spotBy = new Map(spot.filter((s) => s.close > 0).map((s) => [s.date, s.close]));
  const rateAt = asOfLookup(rate, opts.maxRateStaleDays ?? RATE_MAX_STALE_DAYS);
  const points: BasisPoint[] = [];
  let excluded = 0;
  let unmatched = 0;
  for (const f of [...front].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (!f.lastTrade) {
      unmatched++;
      continue;
    }
    const days = calendarDays(f.date, f.lastTrade);
    if (days <= minDays) {
      excluded++;
      continue;
    }
    const s = spotBy.get(f.date);
    const r = rateAt(f.date);
    if (s === undefined || r === null) {
      unmatched++;
      continue;
    }
    const basis = annualizedBasis(f.close, s, days);
    if (!Number.isFinite(basis)) {
      unmatched++;
      continue;
    }
    const tbill = r / 100;
    points.push({
      date: f.date,
      contract: f.contract,
      lastTrade: f.lastTrade,
      daysToExpiry: days,
      spot: s,
      future: f.close,
      volume: f.volume,
      basis,
      tbill,
      excess: basis - tbill,
    });
  }
  return { points, excluded, unmatched };
}
