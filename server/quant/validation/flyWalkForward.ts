import { rollingZScore } from "../engine/zscore.js";
import { isStructuralMove } from "../engine/regimeFilter.js";
import { netPnl, ZERO_COST, type CostConfig } from "./costModel.js";
import { performance, type PerfMetrics } from "./metrics.js";
import type { OosTrade, ValidationStatus, WalkForwardResult } from "./walkForward.js";

/**
 * Walk-forward out-of-sample validation for a BUTTERFLY (EngineMR #1). A fly is a
 * curvature-reversion trade, not a seasonal window, so `walkForwardSeasonal` is the
 * wrong validator. Here the rule is: when the fly spread is statistically stretched
 * (|z| ≥ minZ) AND the front outright is NOT in a structural move, FADE the bow;
 * exit when it reverts to its mean (z crosses 0) or after `H` bars. The z uses only
 * trailing data, so every entry is decided look-ahead-safe; trades are bucketed by
 * entry year for the equity curve. Net of `cost`. PURE (no IO, no Date).
 *
 * The result shares `WalkForwardResult`'s shape so `validate.ts` writes it
 * identically and the `EquityCurve` / robustness UI consume it unchanged.
 */
export interface FlyWalkForwardOpts {
  pointValue?: number;
  cost?: CostConfig;
  n?: number; // z-score / noise-band window (default 60)
  minZ?: number; // entry threshold on |z| (default 1.5, matches gateFly)
  holdBars?: number; // max holding period before a timeout exit (default 30)
  minTrainYears?: number; // skip entries in the first N years (default 5)
  k?: number; // structural-move σ threshold (default 2.5, matches isStructuralMove)
  /** Which stretches to fade: both (default) or only rich ones (z > 0 ⇒ short), e.g. a cash-and-carry basis. */
  sides?: "both" | "short";
  /**
   * `year` (default): one aggregated OOS row per entry year (the fly convention).
   * `trade`: one row per trade with its real entry day-of-year, so regime windows
   * are matched on the actual entry date and the gate counts individual trades.
   */
  aggregate?: "year" | "trade";
  /**
   * Bars between a decision and its fill (default 0: filled at the signal bar's value).
   * With 1, entry and exit fill at the NEXT observation, so a trade cannot profit
   * from the same measurement noise that triggered it (e.g. a basis built from
   * non-simultaneous spot and futures closes).
   */
  executionLag?: number;
}

/**
 * @param spread  the fly instrument's value per date (= near − 2·mid + far)
 * @param dates   YYYY-MM-DD aligned with `spread`
 * @param outLevels the front outright's level per date (aligned with `dates`; null where missing) — the regime gate
 */
export function flyWalkForward(
  spread: number[],
  dates: string[],
  outLevels: (number | null)[],
  opts: FlyWalkForwardOpts = {},
): WalkForwardResult {
  const pv = opts.pointValue ?? 1;
  const cost = opts.cost ?? ZERO_COST;
  const n = opts.n ?? 60;
  const minZ = opts.minZ ?? 1.5;
  const holdBars = opts.holdBars ?? 30;
  const minTrainYears = opts.minTrainYears ?? 5;
  const k = opts.k ?? 2.5;
  const shortOnly = opts.sides === "short";
  const perTrade = opts.aggregate === "trade";
  const lag = Math.max(0, Math.floor(opts.executionLag ?? 0));
  const MIN_OOS = 3;

  const N = Math.min(spread.length, dates.length);
  const trades: OosTrade[] = [];
  if (N === 0) return { trades, metrics: performance([]), validationStatus: "untested", reason: "no data" };

  const firstYear = Number(dates[0].slice(0, 4));
  let pos: { idx: number; side: 1 | -1; entry: number } | null = null;

  for (let i = n; i < N; i++) {
    // Only the trailing n window matters for the z and the noise band — slice that,
    // not the growing prefix, so the whole pass is O(N·n), not O(N²).
    const z = rollingZScore(spread.slice(i + 1 - n, i + 1), n);
    if (!Number.isFinite(z)) continue;
    const year = Number(dates[i].slice(0, 4));

    if (pos === null) {
      if (year - firstYear < minTrainYears) continue; // warm-up: don't count early entries
      const outTrail = outLevels.slice(Math.max(0, i + 1 - n), i + 1).filter((v): v is number => v != null && Number.isFinite(v));
      const structural = outTrail.length > 0 && isStructuralMove([outTrail], n, k);
      if (!structural && Math.abs(z) >= minZ && !(shortOnly && z < 0) && i + lag < N) {
        // fade the stretch: z>0 (spread rich) ⇒ short; z<0 (cheap) ⇒ long.
        pos = { idx: i, side: z > 0 ? -1 : 1, entry: spread[i + lag] };
      }
    } else {
      const held = i - pos.idx;
      const reverted = pos.side === -1 ? z <= 0 : z >= 0;
      if (reverted || held >= holdBars) {
        const gross = pos.side * (spread[Math.min(N - 1, i + lag)] - pos.entry) * pv;
        trades.push({
          year: Number(dates[pos.idx].slice(0, 4)),
          entryDoy: perTrade ? dayOfYear(dates[pos.idx]) : 0,
          exitDoy: perTrade ? dayOfYear(dates[i]) : 0,
          side: pos.side === 1 ? "long" : "short",
          grossPnl: Number(gross.toFixed(2)),
          netPnl: Number(netPnl(gross, cost).toFixed(2)),
        });
        pos = null;
      }
    }
  }

  // Aggregate to one entry per year (the equity curve plots a point per year).
  const byYear = new Map<number, OosTrade>();
  for (const t of trades) {
    const cur = byYear.get(t.year);
    if (!cur) byYear.set(t.year, { ...t });
    else {
      cur.grossPnl = Number((cur.grossPnl + t.grossPnl).toFixed(2));
      cur.netPnl = Number((cur.netPnl + t.netPnl).toFixed(2));
    }
  }
  const yearly = perTrade ? trades : [...byYear.values()].sort((a, b) => a.year - b.year);

  const metrics: PerfMetrics = performance(yearly.map((t) => t.netPnl));
  let validationStatus: ValidationStatus = "untested";
  let reason = perTrade
    ? `${yearly.length} OOS trade(s); need ≥ ${MIN_OOS}`
    : `${yearly.length} OOS year(s) with fly trades; need ≥ ${MIN_OOS}`;
  if (yearly.length >= MIN_OOS) {
    const ok = metrics.winRate >= 0.6 && metrics.avgPnl > 0 && Math.abs(metrics.tStat) >= 1.5;
    validationStatus = ok ? "passed" : "failed";
    reason = ok
      ? `OOS winRate ${(metrics.winRate * 100).toFixed(0)}%, avg $${metrics.avgPnl}, t=${metrics.tStat} (${trades.length} fly trades)`
      : `OOS edge insufficient (winRate ${(metrics.winRate * 100).toFixed(0)}%, avg $${metrics.avgPnl}, t=${metrics.tStat})`;
  }

  return { trades: yearly, metrics, validationStatus, reason };
}

/** Day of year (1-366) of an ISO date. */
function dayOfYear(iso: string): number {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Math.floor((t - Date.UTC(Number(iso.slice(0, 4)), 0, 1)) / 86_400_000) + 1;
}
