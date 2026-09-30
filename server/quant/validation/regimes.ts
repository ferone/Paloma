import type { WalkForwardResult, ValidationStatus } from "./walkForward.js";
import { performance, type PerfMetrics } from "./metrics.js";
import { RELATIVE_VALUE_PAIRS, UNIVERSE, assetOfRoot, type AssetClass, type AssetId } from "../../../shared/universe.js";

/**
 * Regime-exclusion robustness (P4 honest-validation gate).
 *
 * Some out-of-sample "edges" are really one-off artifacts of a macro shock (the
 * 2011 silver blow-off, the 2013 taper crash, the 2020 EFP dislocation). This
 * module asks: does the OOS edge SURVIVE removing the years that entered during a
 * known shock? It filters the ALREADY-computed OOS trades and re-applies the SAME
 * gate — no extra walk-forward, no change to the headline `validationStatus`. A
 * `passed` edge that collapses here is anomaly-driven and should be trusted less.
 * PURE.
 */

export interface RegimeWindow {
  name: string;
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
  note: string;
}

/**
 * Widely-reported impact windows of real macro shocks to the precious-metals
 * complex (COMEX gold + silver). These are documented historical facts (not fit
 * to the data); the notes cite the event. Conservative windows — better to
 * over-cover a shock than to credit an edge to it. The list is FROZEN: adding a
 * window requires a documented exogenous event, never a price-pattern read.
 */
export const REGIME_WINDOWS: RegimeWindow[] = [
  {
    name: "Silver-2011",
    start: "2011-04-01",
    end: "2011-09-30",
    note: "Silver's parabolic run to ~$49 and the CME margin-hike crash (May 2011), then gold's August 2011 peak, dislocated the precious complex.",
  },
  {
    name: "Taper-2013",
    start: "2013-04-01",
    end: "2013-07-31",
    note: "Gold's taper-tantrum collapse (the April 12–15 2013 two-day crash) broke the post-2008 uptrend.",
  },
  {
    name: "COVID-EFP",
    start: "2020-03-01",
    end: "2020-09-30",
    note: "Pandemic refinery closures and the air-freight halt blew out the COMEX–London EFP; futures decoupled from spot (March 2020).",
  },
  {
    name: "Silver-Squeeze-2021",
    start: "2021-01-25",
    end: "2021-03-31",
    note: "The retail 'silver squeeze' (late Jan–Feb 2021) drained ETF and bullion inventories and spiked silver volatility.",
  },
  {
    name: "Tariff-EFP-2025",
    start: "2024-12-01",
    end: "2025-04-30",
    note: "US tariff threats pulled metal into COMEX warehouses, stretching the EFP and front calendar spreads.",
  },
  {
    name: "London-Squeeze-2025",
    start: "2025-09-15",
    end: "2025-11-30",
    note: "A London silver liquidity squeeze (record lease rates, October 2025) inverted the silver curve and spiked precious-metals volatility.",
  },
];

/**
 * Documented shocks to digital assets (CME bitcoin). Same rules as the precious
 * list: exogenous, dated events only; frozen. Unused until a crypto asset exists.
 */
export const CRYPTO_REGIME_WINDOWS: RegimeWindow[] = [
  {
    name: "COVID-Crash-2020",
    start: "2020-03-01",
    end: "2020-04-30",
    note: "The 12 March 2020 'Black Thursday' liquidation halved bitcoin in two sessions as every risk asset was sold for dollars.",
  },
  {
    name: "China-Mining-Ban-2021",
    start: "2021-05-10",
    end: "2021-07-31",
    note: "China's May 2021 crackdown on bitcoin mining (and Tesla dropping BTC payments) forced the hash-rate exodus and a ~50% drawdown.",
  },
  {
    name: "FTX-2022",
    start: "2022-11-01",
    end: "2022-12-31",
    note: "The FTX/Alameda collapse (8–11 November 2022) froze exchange balances and dislocated crypto basis and funding.",
  },
  {
    name: "Spot-ETF-2024",
    start: "2024-01-02",
    end: "2024-02-29",
    note: "SEC approval (10 January 2024) and launch of US spot bitcoin ETFs re-priced the CME basis and pulled flows between wrappers.",
  },
];

/**
 * Documented shocks to industrial metals (COMEX copper). Frozen; unused until
 * an industrial asset exists.
 */
export const INDUSTRIAL_REGIME_WINDOWS: RegimeWindow[] = [
  {
    name: "COVID-2020",
    start: "2020-03-01",
    end: "2020-05-31",
    note: "Pandemic demand collapse (copper to ~$2.10/lb in March 2020) followed by the China-led restocking rebound.",
  },
  {
    name: "LME-Nickel-2022",
    start: "2022-03-01",
    end: "2022-04-30",
    note: "The LME nickel short squeeze (8 March 2022) suspended trading and cancelled trades, spilling volatility across base metals.",
  },
  {
    name: "Copper-Tariff-EFP-2025",
    start: "2025-02-15",
    end: "2025-08-15",
    note: "The US Section 232 copper investigation and July 2025 tariff decision blew out the COMEX–LME premium, then collapsed it when refined cathode was exempted.",
  },
];

/** Shock windows per asset class. Precious = the original REGIME_WINDOWS (unchanged). */
export const REGIMES_BY_CLASS: Record<AssetClass, RegimeWindow[]> = {
  precious: REGIME_WINDOWS,
  industrial: INDUSTRIAL_REGIME_WINDOWS,
  crypto: CRYPTO_REGIME_WINDOWS,
};

/** Shock windows for an asset, keyed by its `assetClass`. PURE. */
export function regimesForAsset(asset: AssetId): RegimeWindow[] {
  return REGIMES_BY_CLASS[UNIVERSE[asset].assetClass];
}

/** Asset classes behind an id prefix: a futures root → its asset; a pair id → both legs. */
function classesOf(prefix: string): AssetClass[] {
  const asset = assetOfRoot(prefix);
  if (asset) return [UNIVERSE[asset].assetClass];
  const pair = RELATIVE_VALUE_PAIRS.find((p) => p.id === prefix);
  if (pair) return [UNIVERSE[pair.numerator].assetClass, UNIVERSE[pair.denominator].assetClass];
  return [];
}

/** Union of several classes' windows (de-duplicated by name, ordered by start). */
function unionOf(classes: AssetClass[]): RegimeWindow[] {
  const distinct = [...new Set(classes)];
  if (distinct.length === 1) return REGIMES_BY_CLASS[distinct[0]];
  const byName = new Map<string, RegimeWindow>();
  for (const c of distinct) for (const w of REGIMES_BY_CLASS[c]) if (!byName.has(w.name)) byName.set(w.name, w);
  return [...byName.values()].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/**
 * The shock windows for a product root or instrument id (e.g. "GC",
 * "SI.cal.0-1", "GS.ratio"), keyed by the owning asset's `assetClass`. A
 * relative-value pair across classes gets the union of both lists. Unknown ids
 * fall back to the precious-metals list. `classesFor` is injectable for tests. PURE.
 */
export function regimesFor(productOrId: string, classesFor: (prefix: string) => AssetClass[] = classesOf): RegimeWindow[] {
  const classes = classesFor(productOrId.split(".")[0]);
  return classes.length ? unionOf(classes) : REGIME_WINDOWS;
}

/** ISO date (UTC) for an OOS trade's (year, entry day-of-year). */
function tradeDate(year: number, entryDoy: number): string {
  return new Date(Date.UTC(year, 0, Math.max(1, entryDoy))).toISOString().slice(0, 10);
}

/** Name of the regime window containing `date`, or null. */
export function regimeOf(date: string, regimes: RegimeWindow[] = REGIME_WINDOWS): string | null {
  for (const r of regimes) if (date >= r.start && date <= r.end) return r.name;
  return null;
}

// Mirrors walkForwardSeasonal's pass bar (≥3 OOS, net winRate ≥ 0.6, avgPnl > 0, |t| ≥ 1.5).
const MIN_OOS = 3;
function gate(m: PerfMetrics): ValidationStatus {
  if (m.trades < MIN_OOS) return "untested";
  return m.winRate >= 0.6 && m.avgPnl > 0 && Math.abs(m.tStat) >= 1.5 ? "passed" : "failed";
}

export interface RegimeRobustness {
  regimesHit: string[]; // distinct regimes that captured ≥1 OOS trade
  excludedTrades: number;
  fullStatus: ValidationStatus;
  exRegimeStatus: ValidationStatus; // status after dropping regime-year trades
  exRegimeMetrics: PerfMetrics;
  survives: boolean; // passed BOTH full and ex-regime
  note: string;
}

export function regimeRobustness(
  wf: WalkForwardResult,
  regimes: RegimeWindow[] = REGIME_WINDOWS,
): RegimeRobustness {
  const hit = new Set<string>();
  const kept: number[] = [];
  for (const t of wf.trades) {
    const reg = regimeOf(tradeDate(t.year, t.entryDoy), regimes);
    if (reg) hit.add(reg);
    else kept.push(t.netPnl);
  }
  const exRegimeMetrics = performance(kept);
  const exRegimeStatus = gate(exRegimeMetrics);
  const survives = wf.validationStatus === "passed" && exRegimeStatus === "passed";
  const excludedTrades = wf.trades.length - kept.length;
  const hits = [...hit].join("/");
  const note =
    excludedTrades === 0
      ? "No OOS years fell in a tracked shock window."
      : survives
        ? `Edge holds after dropping ${excludedTrades} ${hits} year(s).`
        : `Edge weakens to ${exRegimeStatus} after dropping ${excludedTrades} ${hits} year(s) — likely anomaly-driven.`;
  return {
    regimesHit: [...hit],
    excludedTrades,
    fullStatus: wf.validationStatus,
    exRegimeStatus,
    exRegimeMetrics,
    survives,
    note,
  };
}
