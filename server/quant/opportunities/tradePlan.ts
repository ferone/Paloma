/**
 * Expected-profit / trade plan for a spread or butterfly — a PURE, defensible model
 * (no fabricated data): given the current structure value (entry), the reversion
 * target (rolling/seasonal mean), the $/point, and the engine's own corroborating
 * numbers (ML expected move, OOS average + max drawdown, the value's σ), it returns
 * a structure-level plan: expected $, a structural stop, risk $, reward:risk, and an
 * entry zone. It is explicitly an ESTIMATE (a convergence filter, not a guarantee);
 * the UI labels it so. Structure-level (you trade the combo as one net order).
 */
export interface TradePlanInput {
  direction: "long" | "short" | null; // verdict trade direction on the structure
  entry: number; // current structure value (latest spread)
  target: number; // reversion target (rolling mean / seasonal-normal level)
  pointValue: number; // $ per 1.0 of the structure's value
  sd?: number | null; // σ of the structure value (for the stop band + entry zone)
  mlExpectedMove?: number | null; // per-contract $ from ML (cross-check)
  oosAvgPnl?: number | null; // $/trade out-of-sample (cross-check)
  oosMaxDrawdown?: number | null; // $ (≤0) out-of-sample → realistic risk
  oosWinRate?: number | null;
  stopSigma?: number; // adverse σ for the structural stop (default 2)
}

export interface TradePlan {
  side: 1 | -1 | 0; // +1 long the structure, -1 short, 0 stand aside
  entry: number;
  target: number;
  stop: number | null; // value level of the structural stop
  expected$: number; // side·(target−entry)·pv
  risk$: number | null; // realistic loss if stopped (positive number)
  rr: number | null; // reward : risk
  mlExpected$: number | null; // ML cross-check (signed toward the trade)
  oosAvg$: number | null;
  winRate: number | null;
  entryZone: [number, number] | null; // value band where the edge still holds
  note: string;
}

const sign = (d: "long" | "short" | null): 1 | -1 | 0 => (d === "long" ? 1 : d === "short" ? -1 : 0);

export function buildTradePlan(i: TradePlanInput): TradePlan {
  const side = sign(i.direction);
  const pv = i.pointValue || 1;
  const expected$ = side === 0 ? 0 : Number((side * (i.target - i.entry) * pv).toFixed(2));
  const k = i.stopSigma ?? 2;

  // Risk: prefer the OOS max drawdown (realistic), else a 2σ adverse band on the value.
  const bandRisk = i.sd != null && i.sd > 0 ? Number((k * i.sd * pv).toFixed(2)) : null;
  const risk$ = i.oosMaxDrawdown != null && i.oosMaxDrawdown < 0 ? Math.abs(i.oosMaxDrawdown) : bandRisk;

  // Stop VALUE level so the payoff chart's stop aligns with risk$ (adverse direction).
  const stop = side === 0 || risk$ == null ? null : Number((i.entry - side * (risk$ / pv)).toFixed(4));

  const rr = expected$ > 0 && risk$ != null && risk$ > 0 ? Number((expected$ / risk$).toFixed(2)) : null;
  const mlExpected$ = i.mlExpectedMove != null ? Number((side * Math.abs(i.mlExpectedMove)).toFixed(2)) : null;
  const entryZone: [number, number] | null = i.sd != null && i.sd > 0 ? [Number((i.entry - 0.5 * i.sd).toFixed(4)), Number((i.entry + 0.5 * i.sd).toFixed(4))] : null;

  const note =
    side === 0
      ? "No directional edge — stand aside."
      : `Estimate: fade to the ${i.target > i.entry ? "higher" : "lower"} reversion target; structural stop at ${k}σ. Convergence filter, not a guarantee — trade the combo as one net order.`;

  return {
    side,
    entry: Number(i.entry.toFixed(4)),
    target: Number(i.target.toFixed(4)),
    stop,
    expected$,
    risk$: risk$ != null ? Number(risk$.toFixed(2)) : null,
    rr,
    mlExpected$,
    oosAvg$: i.oosAvgPnl != null ? Number(i.oosAvgPnl.toFixed(2)) : null,
    winRate: i.oosWinRate ?? null,
    entryZone,
    note,
  };
}
