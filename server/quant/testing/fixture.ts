/**
 * TEST-ONLY synthetic market fixture. Generates a deterministic multi-year set of
 * COMEX-style contracts (ALL 12 months listed, like the real exchange, so tests
 * can prove the serial months are ignored) with daily bars.
 *
 * Model (transform fixture, not market data — never shown in the UI):
 *   spot_t   = seeded mean-reverting log random walk around `spot0`
 *   F(T)_t   = spot_t · (1 + carry · τ) + seasonal wiggle + tiny contract noise
 * so the curve is in contango and calendar spreads mean-revert.
 *
 * Imported only from *.test.ts files.
 */
import { contractExpiry } from "../universe/contracts.js";
import type { RawBar, RawContract } from "../data/continuous.js";

const CODES = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"];

/** Small seeded PRNG (mulberry32) so fixtures are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  const u = Math.max(1e-12, r());
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Weekdays between two ISO dates inclusive. */
export function businessDays(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export interface FixtureOpts {
  root: string;
  startYear: number;
  endDate: string; // last bar date
  spot0: number;
  vol?: number; // daily log vol
  carry?: number; // annual carry fraction
  seed?: number;
  /** Months listed before the contract month. */
  listMonths?: number;
}

export interface Fixture {
  contracts: RawContract[];
  bars: RawBar[];
  spot: Map<string, number>;
}

export function makeFixture(o: FixtureOpts): Fixture {
  const r = rng(o.seed ?? 7);
  const vol = o.vol ?? 0.01;
  const carry = o.carry ?? 0.04;
  const listMonths = o.listMonths ?? 18;
  const days = businessDays(`${o.startYear}-01-01`, o.endDate);
  const spot = new Map<string, number>();
  let logS = Math.log(o.spot0);
  const mu = Math.log(o.spot0);
  for (const d of days) {
    logS += 0.002 * (mu - logS) + vol * gauss(r);
    spot.set(d, Math.exp(logS));
  }

  const endYear = Number(o.endDate.slice(0, 4)) + 2;
  const contracts: RawContract[] = [];
  const bars: RawBar[] = [];
  for (let y = o.startYear; y <= endYear; y++) {
    for (let m = 1; m <= 12; m++) {
      const exp = contractExpiry(o.root, m, y);
      const lastTrade = exp?.lastTrade ?? `${y}-${String(m).padStart(2, "0")}-25`;
      const symbol = `${o.root}${CODES[m - 1]}${String(y % 100).padStart(2, "0")}`;
      contracts.push({ symbol, root: o.root, year: y, month: m, lastTrade, firstNotice: exp?.firstNotice ?? null });
      const listTotal = y * 12 + (m - 1) - listMonths;
      const listDate = `${Math.floor(listTotal / 12)}-${String((listTotal % 12) + 1).padStart(2, "0")}-01`;
      const expiryT = Date.UTC(y, m - 1, 28);
      for (const d of days) {
        if (d < listDate || d > lastTrade) continue;
        const s = spot.get(d)!;
        const tau = Math.max(0, (expiryT - Date.parse(`${d}T00:00:00Z`)) / (365 * 86400000));
        const doy = (Date.parse(`${d}T00:00:00Z`) - Date.UTC(Number(d.slice(0, 4)), 0, 1)) / 86400000;
        const wiggle = 0.002 * s * Math.sin((2 * Math.PI * doy) / 365) * tau;
        const close = Number((s * (1 + carry * tau) + wiggle + s * 0.0004 * gauss(r)).toFixed(3));
        bars.push({ symbol, date: d, close, volume: Math.round(1000 + 5000 * r()), openInterest: null });
      }
    }
  }
  return { contracts, bars, spot };
}
