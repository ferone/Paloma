import type { BasisView, ContractLegView, GatesView, InstrumentDetail, OosView, QuantMode, VerdictView } from "../../../shared/quant.js";
import type { AssetId, CarryBasisSpec, FuturesProduct } from "../../../shared/universe.js";
import type { PricePoint, SeriesPoint } from "../types/index.js";
import { buildAsOf } from "../features/buildAsOf.js";
import { scoreAsOf } from "../engine/score.js";
import { ouFit } from "../engine/ou.js";
import { isStructuralMove, noiseBand } from "../engine/regimeFilter.js";
import { decideVerdict, type VerdictMode } from "../engine/verdict.js";
import { assembleDecision } from "../engine/decision.js";
import { buildTradePlan } from "../opportunities/tradePlan.js";
import { buildQtOpportunity } from "../opportunities/qtScanner.js";
import { flyWalkForward } from "../validation/flyWalkForward.js";
import { regimeRobustness, regimesFor } from "../validation/regimes.js";
import type { CostConfig } from "../validation/costModel.js";
import { stdSample } from "../seasonality/util.js";
import { BASIS_MIN_DAYS, type BasisPoint, type BasisSeries } from "../data/basis.js";
import { CASH_ROLL_BDAYS } from "../data/continuous.js";
import {
  STRUCT_K,
  STRUCT_N,
  capacityView,
  decisionView,
  rowsFor,
  scoreView,
  seasonalityDetail,
  volPercentile,
  type AnalyzedInstrument,
  type RunContext,
} from "./analyze.js";
import { halfKelly, oosView, ouView, rollingBands, round, verdictView } from "./helpers.js";

/**
 * The cash-and-carry basis as a quant instrument (`<root>.basis`). The series
 * the engine reads is the EXCESS carry — annualized front-vs-spot basis minus
 * the T-bill, in % p.a. — and it goes through the same mean-reversion machinery
 * as every spread: rolling z, OU half-life, a walk-forward z-fade, regime
 * robustness on the asset's shock windows and the verdict layer.
 *
 * The trade is one-sided. Rich excess carry (z > 0) ⇒ long spot / short the
 * front future: a carry harvest that is flat the asset, earning the basis as it
 * converges at expiry, less funding. Cheap excess carry (z < 0) would call for
 * a reverse cash-and-carry (short spot), which the fund does not run, so the
 * engine says stand aside / unwind instead. The walk-forward tests exactly that
 * rule (short-only fades). PURE.
 */

/** Round-trip friction of the basis trade in bp of annualized carry (see `BASIS_COST_NOTE`). */
export const BASIS_COST_BP = Math.round((10 * 365) / 42);
const BASIS_COST_NOTE = `~${BASIS_COST_BP} bp: ~10 bp of notional round trip across both legs, spread over the ~6-week maximum hold`;

const MODES: QuantMode[] = ["conservative", "aggressive"];

export interface BasisInput {
  asset: AssetId;
  assetLabel: string;
  /** Unit label of the asset's price, e.g. "BTC" (per contract sizing). */
  priceUnit: string;
  product: FuturesProduct;
  spec: CarryBasisSpec;
  series: BasisSeries;
}

const pct = (x: number) => round(x * 100, 4);
const fmt = (x: number, dp = 2) => x.toFixed(dp);
const usd = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;

/** $ per 1 bp of ANNUALIZED basis, per contract: size × S × days/365 × 1e-4. */
export function dollarsPerBp(spot: number, days: number, contractSize: number): number {
  return (contractSize * spot * days) / 365 / 10_000;
}

/** Carry to expiry per contract: locked-in basis, T-bill funding of the spot leg, and the excess. */
export function carryToExpiry(p: Pick<BasisPoint, "spot" | "future" | "tbill" | "daysToExpiry">, contractSize: number) {
  const gross = (p.future - p.spot) * contractSize;
  const funding = p.spot * p.tbill * (p.daysToExpiry / 365) * contractSize;
  return { gross, funding, excess: gross - funding };
}

function basisPointView(p: BasisPoint) {
  return {
    date: p.date,
    contract: p.contract,
    daysToExpiry: p.daysToExpiry,
    spot: round(p.spot, 2),
    future: round(p.future, 2),
    basis: pct(p.basis),
    tbill: pct(p.tbill),
    excess: pct(p.excess),
  };
}

export function analyzeBasis(input: BasisInput, ctx: RunContext): AnalyzedInstrument | null {
  const { cfg, qt } = ctx;
  const { asset, product, spec } = input;
  const pts = input.series.points.filter((p) => p.date <= ctx.asOf);
  if (pts.length < cfg.N + 20) return null;
  const id = `${product.root}.basis`;
  const label = `${input.assetLabel} cash-and-carry basis (${product.root} front vs ${spec.spot}, over the ${spec.rateLabel})`;
  const size = product.contractSize;
  const last = pts[pts.length - 1];
  const asOf = last.date;

  // The engine series: excess carry in % p.a.
  const history: SeriesPoint[] = pts.map((p) => ({ date: p.date, value: pct(p.excess), volume: p.volume }));
  const values = history.map((p) => p.value);
  const prices: PricePoint[] = history.map((p) => ({ date: p.date, spread: p.value, volume: p.volume }));
  const row = scoreAsOf(id, buildAsOf(asOf, prices, []), cfg, "qt");
  const z = row?.z ?? 0;
  const fit = ouFit(values, qt.ou.window, qt.ou.minObs);
  const ou = ouView(fit, values, qt);

  // Structural gate on SPOT: a breakout is when basis spikes and a short future draws margin calls.
  const spotLevels = pts.map((p) => p.spot);
  const structural = isStructuralMove([spotLevels], STRUCT_N, STRUCT_K);
  const band = noiseBand(spotLevels, STRUCT_N);
  const gates: GatesView = {
    ouTradable: ou?.tradable ?? false,
    carryConflict: false,
    structural,
    structuralDetail: `${spec.spot} ${band ? band.zNow.toFixed(2) : "—"}σ from its ${STRUCT_N}-day band (gate at ${STRUCT_K}σ): a spot breakout blocks new carry entries`,
  };

  // Walk-forward: short-only fades of rich excess carry, in bp, one row per trade.
  const cost: CostConfig = { commission: 0, bidAsk: BASIS_COST_BP, slippage: 0 };
  const wf = flyWalkForward(
    values.map((v) => v * 100),
    history.map((p) => p.date),
    spotLevels,
    { pointValue: 1, cost, n: cfg.N, sides: "short", aggregate: "trade", executionLag: 1 },
  );
  const m = wf.metrics;
  wf.reason =
    wf.validationStatus === "untested"
      ? `${m.trades} out-of-sample carry trade(s); need ≥ 3`
      : `${wf.validationStatus === "passed" ? "OOS" : "OOS edge insufficient:"} win rate ${(m.winRate * 100).toFixed(0)}%, avg ${fmt(m.avgPnl, 0)} bp, t = ${m.tStat} over ${m.trades} short-only fades of rich excess carry`;
  const regime = regimeRobustness(wf, regimesFor(id));
  const pnlUnit = `bp of annualized excess carry per trade, net of ${BASIS_COST_NOTE}`;
  const oos: OosView = oosView(wf, "z-fade", pnlUnit, regime);
  // Per-trade validation: regime exclusions drop trades, not years.
  if (oos.regime) oos.regime.note = oos.regime.note.replace("year(s)", "trade(s)");
  const byYear = new Map<number, number>();
  for (const t of wf.trades) byYear.set(t.year, (byYear.get(t.year) ?? 0) + t.netPnl);
  oos.yearly = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, netPnl]) => ({ year, netPnl: round(netPnl, 2) }));

  // Direction: the engine fades z; only the rich side is a trade this fund runs.
  const fade: "long" | "short" | null = z > 0 ? "short" : z < 0 ? "long" : null;
  const direction: "short" | null = fade === "short" ? "short" : null;
  const legs: ContractLegView[] = [
    { leg: `${spec.spot} spot`, contract: spec.spot, side: "long", qty: size },
    { leg: `${product.root}.c.0`, contract: last.contract, side: "short", qty: 1 },
  ];
  const carryText = `buy ${size} ${input.priceUnit} spot (${spec.spot}), sell 1 ${last.contract}`;
  const survivesRegime = regime.survives || wf.validationStatus !== "passed" ? undefined : false;

  const verdicts = Object.fromEntries(
    MODES.map((mode) => {
      const v = decideVerdict(
        {
          signal: { z, score: row?.score ?? 0, avoidOverride: row?.avoidOverride ?? false },
          validationStatus: wf.validationStatus,
          seasonal: null,
          ml: null,
          survivesRegime,
          regimeOff: structural ? true : undefined,
          ouTradable: gates.ouTradable,
        },
        mode as VerdictMode,
        cfg,
      );
      if (fade === "long") {
        v.verdict = "AVOID";
        v.blockers.unshift(
          "excess carry is cheap (z < 0): fading it means a reverse cash-and-carry (short spot, long future), which this fund does not run",
        );
      }
      const view: VerdictView = verdictView(v, "basis", direction, { long: carryText, short: carryText });
      view.instruction =
        view.action !== "AVOID"
          ? `Long spot / short front future: ${carryText}`
          : fade === "long"
            ? "Stand aside: excess carry is cheap — unwind existing long-spot / short-future carry rather than add"
            : "Stand aside on the basis";
      return [mode, view];
    }),
  ) as Record<QuantMode, VerdictView>;

  // Trade plan in bp of annualized carry and $ per contract.
  const perBp = dollarsPerBp(last.spot, last.daysToExpiry, size);
  const bp = values.map((v) => v * 100);
  const window = bp.slice(-cfg.N);
  const meanBp = window.reduce((a, b) => a + b, 0) / window.length;
  const sdBp = stdSample(window);
  const entryBp = bp[bp.length - 1];
  const plan = buildTradePlan({
    direction,
    entry: entryBp,
    target: meanBp,
    pointValue: perBp,
    sd: sdBp,
    oosAvgPnl: m.trades ? m.avgPnl * perBp : null,
    oosMaxDrawdown: m.trades ? m.maxDrawdown * perBp : null,
    oosWinRate: m.trades ? m.winRate : null,
  });
  const carry = carryToExpiry(last, size);
  const expiryText = `${last.daysToExpiry} days to ${last.contract} last trade`;
  const planNote =
    direction === "short"
      ? `Estimate: excess carry ${fmt(entryBp, 0)} bp vs its ${cfg.N}-day mean ${fmt(meanBp, 0)} bp. Reversion is worth ≈ ${usd(plan.expected$)} per contract at $${perBp.toFixed(2)} per bp (today's spot, ${expiryText}); held to expiry the pair instead locks ≈ ${usd(carry.excess)} over the T-bill per contract.`
      : fade === "long"
        ? `Stand aside: excess carry ${fmt(entryBp, 0)} bp sits below its ${cfg.N}-day mean ${fmt(meanBp, 0)} bp. Unwind existing long-spot / short-future carry rather than add; held to expiry it still earns ≈ ${usd(carry.excess)} over the T-bill per contract.`
        : "Excess carry sits at its mean — no reversion edge; the carry to expiry is the only return.";

  const cand = {
    instrumentId: id,
    label,
    kind: "basis" as const,
    product: product.root,
    asOf,
    pointValue: 1,
    values,
    latest: row,
    ou: fit,
    carry: null,
    structural,
    oos: { status: wf.validationStatus, sharpe: m.sharpe, avgPnl: m.avgPnl, years: m.trades, survivesRegime: wf.validationStatus === "passed" ? regime.survives : null },
    ml: null,
    seasonal: null,
  };
  const qtOpp = buildQtOpportunity(cand, qt);
  const evidence = [
    `basis ${fmt(pct(last.basis))}% p.a. on ${last.contract} (${last.daysToExpiry} d to last trade) vs ${spec.rateLabel} ${fmt(pct(last.tbill))}% → excess carry ${fmt(pct(last.excess))}% p.a. (${fmt(pct(last.excess) * 100, 0)} bp)`,
    `carry harvest, not a directional bet: long ${size} ${input.priceUnit} spot against 1 short ${last.contract} is flat ${input.assetLabel.toLowerCase()}; the P&L is the basis converging at expiry, less funding`,
    `to expiry, per contract: basis ${usd(carry.gross)} − T-bill funding ${usd(carry.funding)} = excess ${usd(carry.excess)}`,
    ...qtOpp.evidence.map((e) =>
      e.startsWith("OOS ") ? e.replace(/(\d+)y, /, "$1 trades, ").replace(/avg \$(-?[\d.]+)/, "avg $1 bp") : e,
    ),
  ];
  if (fade === "long") evidence.push("cheap side: stand aside / unwind — the reverse trade (short spot) is not run");

  const decision = decisionView(
    assembleDecision({
      verdict: verdicts.conservative.action,
      z,
      score: row?.score ?? null,
      avoidOverride: row?.avoidOverride ?? false,
      fundFactor: null,
      validationStatus: wf.validationStatus,
      seasonalAligned: null,
      regimeRobust: wf.validationStatus === "passed" ? regime.survives : null,
      mlPConverge: null,
      mlValidated: false,
      volPercentile: volPercentile(values),
      ai: null,
    }),
  );

  const basis: BasisView = {
    spotSymbol: spec.spot,
    rateSymbol: spec.rate,
    rateLabel: spec.rateLabel,
    settlement: spec.settlement,
    root: product.root,
    contractSize: size,
    priceUnit: input.priceUnit,
    latest: basisPointView(last),
    lastTrade: last.lastTrade,
    excluded: input.series.excluded,
    minDays: BASIS_MIN_DAYS,
    dollarsPerBp: round(perBp, 2),
    grossCarryUsd: round(carry.gross, 2),
    fundingUsd: round(carry.funding, 2),
    excessCarryUsd: round(carry.excess, 2),
    points: pts.map(basisPointView),
  };

  const caveats = [
    "A carry harvest, not a directional bet: the pair is flat the asset; it earns the basis as the future converges to spot at expiry, less the cost of funding the spot leg.",
    `Funding: excess carry is measured over the ${spec.rateLabel}; a desk that funds spot above bills (or pays custody) earns less by that spread.`,
    "Margin calls in spikes: the short future is marked to market daily in cash, while the offsetting spot gain is unrealised (and, held via ETF or custody, not instantly pledgeable). A sharp rally can force an unwind at the worst moment.",
    `Tracking: the future settles to the ${spec.settlement}; a spot leg held through an ETF (NAV, premium/discount) or on an exchange will not match it exactly at expiry.`,
    `Timing: spot is the ${spec.spot} daily close (00:00 UTC); the CME settlement is a few hours earlier, so each daily basis carries some timing noise.`,
    `The front rolls ${CASH_ROLL_BDAYS} business days before last trade (the continuous-series roll); the annualized basis jumps at each roll as the day count resets. ${input.series.excluded} date(s) within ${BASIS_MIN_DAYS} days of expiry were dropped.`,
    `Out-of-sample P&L is in bp of annualized excess carry, not dollars, net of ${BASIS_COST_NOTE}. Entries and exits fill at the next day's basis, so a trade cannot profit from the same close-timing noise that triggered it.`,
  ];

  const detail: InstrumentDetail = {
    id,
    label,
    kind: "basis",
    metal: asset,
    product: product.root,
    unit: "% p.a.",
    pointValue: round(perBp, 2),
    asOf,
    dataThrough: asOf,
    legs,
    series: rollingBands(history, cfg.N),
    bandWindow: cfg.N,
    score: scoreView(row),
    ou,
    carry: null,
    gates,
    structural: null,
    curvature: null,
    verdicts,
    decision,
    plan: {
      side: plan.side,
      entry: plan.entry,
      target: plan.target,
      stop: plan.stop,
      expectedUsd: plan.expected$,
      riskUsd: plan.risk$,
      rewardRisk: plan.rr,
      entryZone: plan.entryZone,
      pointValue: round(perBp, 2),
      unit: "bp p.a.",
      legs,
      capacity: capacityView(pts.map((p) => p.volume)),
      kelly: halfKelly(wf.trades.map((t) => t.netPnl)),
      note: planNote,
    },
    oos,
    ml: null,
    qtRank: qtOpp.qtRank,
    evidence,
    window: null,
    caveats,
    provenance: {
      source: `${ctx.provenanceSource} · Yahoo ${spec.spot}, ${spec.rate}`,
      asOf,
      note: "Front future on the continuous roll vs same-date spot close; T-bill carried over its holidays",
    },
    basis,
  };

  const seasonality = seasonalityDetail({
    id,
    label,
    kind: "basis",
    metal: asset,
    unit: "% p.a.",
    series: history,
    pointValue: 1,
    originDoy: 1,
    yearOffset: 0,
    asOf,
    dataThrough: asOf,
    oos,
    provenanceSource: ctx.provenanceSource,
    windows: [],
  });

  const rows = rowsFor(detail, qtOpp.zEff, row?.tier ?? "AVOID", wf.validationStatus === "passed" ? regime.survives : null, null);
  return { detail, seasonality, rows, sim: null, mirror: false };
}
