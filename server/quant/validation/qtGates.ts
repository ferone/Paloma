import { performance, type PerfMetrics } from "./metrics.js";
import { regimeOf } from "./regimes.js";

/**
 * EngineQT gate ablation — the honest OOS test for SELECTION filters.
 *
 * The QT gates (OU tradability, carry trend veto) never produce P&L of their own:
 * they only choose which point-in-time decisions get traded. So their honest
 * out-of-sample evaluation is an ABLATION over the simulation's already-as-of-
 * gated decisions (each carries the gate flags stamped AT the decision date and
 * the gate-independent passive P&L): compare the decisions a gate would KEEP
 * against everything, per-trade. No seasonal walk-forward, no refitting.
 *
 * The ex-shock column re-runs the same comparison after dropping every decision
 * dated inside a tracked macro-shock window (`REGIME_WINDOWS` via `regimeOf`) —
 * a gate whose apparent uplift evaporates ex-shock was riding an anomaly, and is
 * NOT credited ("helps" requires the ex-shock uplift to hold). PURE (no IO/Date).
 */

export interface GateDecision {
  date: string;
  instrumentId: string;
  /** Passive (always-fade) $ P&L of the decision — the gate-independent outcome. */
  pnl: number;
  ouTradable: boolean;
  carryConflict: boolean;
}

export interface GateAblation {
  gate: "ou" | "carry";
  /** Decisions the gate would keep (trade). */
  kept: PerfMetrics;
  /** Decisions the gate would exclude. */
  removed: PerfMetrics;
  all: PerfMetrics;
  /** kept.avgPnl − all.avgPnl ($/trade — the gate's selection value). */
  upliftPerTrade: number;
  /** Same comparison after dropping decisions dated inside a tracked shock window. */
  exShock: { keptAvg: number; upliftPerTrade: number };
  verdict: "helps" | "hurts" | "neutral" | "insufficient";
}

const MIN_DECISIONS = 30;
const MIN_REMOVED = 10;

/**
 * Ablate both QT gates over a decision ledger.
 *
 * `verdict`:
 *  - "insufficient" — fewer than `minDecisions` decisions overall, or the gate
 *    excluded fewer than 10 (nothing to compare against);
 *  - "helps"   — upliftPerTrade > 0 AND removed.avgPnl < kept.avgPnl AND the
 *    ex-shock uplift is also ≥ 0 (regime-robust);
 *  - "hurts"   — upliftPerTrade < 0;
 *  - "neutral" — everything else (incl. a full-sample uplift that collapses ex-shock).
 */
export function ablateGates(decisions: GateDecision[], minDecisions = MIN_DECISIONS): GateAblation[] {
  return (["ou", "carry"] as const).map((gate) => {
    const keeps = (d: GateDecision): boolean => (gate === "ou" ? d.ouTradable : !d.carryConflict);

    const keptD = decisions.filter(keeps);
    const removedD = decisions.filter((d) => !keeps(d));
    const kept = performance(keptD.map((d) => d.pnl));
    const removed = performance(removedD.map((d) => d.pnl));
    const all = performance(decisions.map((d) => d.pnl));
    const upliftPerTrade = Number((kept.avgPnl - all.avgPnl).toFixed(2));

    const ex = decisions.filter((d) => regimeOf(d.date) === null);
    const exKept = performance(ex.filter(keeps).map((d) => d.pnl));
    const exAll = performance(ex.map((d) => d.pnl));
    const exShock = {
      keptAvg: exKept.avgPnl,
      upliftPerTrade: Number((exKept.avgPnl - exAll.avgPnl).toFixed(2)),
    };

    let verdict: GateAblation["verdict"];
    if (decisions.length < minDecisions || removedD.length < MIN_REMOVED) verdict = "insufficient";
    else if (upliftPerTrade > 0 && removed.avgPnl < kept.avgPnl && exShock.upliftPerTrade >= 0) verdict = "helps";
    else if (upliftPerTrade < 0) verdict = "hurts";
    else verdict = "neutral";

    return { gate, kept, removed, all, upliftPerTrade, exShock, verdict };
  });
}
