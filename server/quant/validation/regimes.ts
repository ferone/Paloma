import type { WalkForwardResult, ValidationStatus } from "./walkForward.js";
import { performance, type PerfMetrics } from "./metrics.js";

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
 * The shock windows for a product root or instrument id (e.g. "GC",
 * "SI.cal.0-1", "GS.ratio"). Every product this app trades is a precious metal,
 * so all resolve to REGIME_WINDOWS; the seam exists so a future complex can carry
 * its own documented list without touching callers. PURE.
 */
export function regimesFor(productOrId: string): RegimeWindow[] {
  void productOrId;
  return REGIME_WINDOWS;
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
