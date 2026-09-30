import { z } from "zod";
import type { AssetId } from "../../../shared/universe.js";

/**
 * Domain types for the Commodity Spread Signal Engine.
 *
 * This is the LEAF layer: pure types + Zod schemas, no logic and no imports
 * from other lib/ layers. Everything else may depend on `lib/types`; it
 * depends on nothing. See lib/README.md for the dependency rule.
 */

/** Convergence tiers (SPEC §4.5). */
export const Tier = {
  STRONG: "STRONG",
  MODERATE: "MODERATE",
  WATCH: "WATCH",
  AVOID: "AVOID",
} as const;
export type Tier = (typeof Tier)[keyof typeof Tier];

/** One price observation for a spread (either built from two legs or pre-built). */
export const PricePointSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO YYYY-MM-DD"),
  leg1: z.number().optional(),
  leg2: z.number().optional(),
  spread: z.number(),
  volume: z.number().optional(), // summed leg volume when available
});
export type PricePoint = z.infer<typeof PricePointSchema>;

/**
 * A USDA fundamentals release. `pubTimestamp` is when the report was published
 * (the look-ahead gate); `effectiveDate` is the data's reference period.
 * Sign convention: positive = supports a WIDER spread (SPEC §3).
 */
export const FundamentalReleaseSchema = z.object({
  report: z.string(),
  effectiveDate: z.string(),
  pubTimestamp: z.string(), // ISO 8601 datetime (the release moment)
  value: z.number(),
  sign: z.number().int(), // +1 or -1
});
export type FundamentalRelease = z.infer<typeof FundamentalReleaseSchema>;

/**
 * Engine configuration. ALL thresholds are config, never hard-coded constants
 * (SPEC §4). Persisted as immutable versioned rows; signals reference `version`.
 */
/**
 * EngineQT parameters (SPEC §4: ALL thresholds are config, never hard-coded).
 * An OPTIONAL block on `Config` — absent for v3/mr, so their persisted JSON is
 * byte-identical. Every weight here is a FIXED, documented constant (calibration
 * = normalization discipline; never argmax-to-P&L).
 */
export const QtParamsSchema = z.object({
  /** Ornstein–Uhlenbeck (AR(1)/OLS) fit → half-life tradability + adaptive lookback. */
  ou: z.object({
    window: z.number().int().positive(), // AR(1) fit window (bars), default 252
    minObs: z.number().int().positive(), // below this: no fit (null), default 120
    halfLifeMin: z.number().positive(), // days; faster = microstructure noise, default 5
    halfLifeMax: z.number().positive(), // days; slower = not tradable within H, default 60
    adaptiveK: z.number().positive(), // N_eff = k·halfLife, default 3
    nMin: z.number().int().positive(), // adaptive-lookback clamp, default 20
    nMax: z.number().int().positive(), // adaptive-lookback clamp, default 120
  }),
  /** Carry / term-structure read from the derived c0/c1/c2 curve. */
  carry: z.object({
    pctWindow: z.number().int().positive(), // slope percentile window (~3y), default 756
    momWindow: z.number().int().positive(), // slope-change momentum window, default 20
    trendZ: z.number().positive(), // |slope momentum z| ≥ this ⇒ trending curve, default 2
    flatEps: z.number().nonnegative(), // |slope| ≤ flatEps·|c0| ⇒ "flat", default 0.001
  }),
  /** Cross-sectional composite weights (FIXED — transparency over fitting). */
  rank: z.object({
    tradabilityBonus: z.number(), // default 25
    carryBonus: z.number(), // default 15
    oosBonus: z.number(), // default 20
    mlBonus: z.number(), // default 20 (mirrors buildOpportunity's (p−0.5)·40 cap)
    gateDamp: z.number(), // multiplier when any veto gate fails, default 0.25
  }),
  /** Correlation-aware selection + vol-target sizing (risk plumbing, not alpha). */
  portfolio: z.object({
    corrWindow: z.number().int().positive(), // trading days of Δvalue, default 120
    corrMax: z.number(), // signed-exposure correlation cap, default 0.6
    maxPositions: z.number().int().positive(), // default 8
    maxPerProduct: z.number().int().positive(), // default 2
    perTradeRisk: z.number().positive(), // $ risk per position over H, default 1000
  }),
});
export type QtParams = z.infer<typeof QtParamsSchema>;

export const ConfigSchema = z.object({
  version: z.number().int().nonnegative(),
  N: z.number().int().positive(), // z-score lookback (business days), default 60
  H: z.number().int().positive(), // seasonal horizon (business days), default 20
  kSeason: z.number().positive(), // season sensitivity scale (k_s)
  kFund: z.number().positive(), // fundamentals sensitivity scale (k_f)
  kVol: z.number().positive().optional(), // v3: volatility-regime dampener sensitivity (k_v); score.ts falls back to 1
  tiers: z.object({
    strong: z.number(), // default 70
    moderate: z.number(), // default 45
    watch: z.number(), // default 25
  }),
  avoidThreshold: z.number(), // default -0.25
  costs: z.object({
    commission: z.number(),
    bidAsk: z.number(),
    slippage: z.number(),
  }),
  qt: QtParamsSchema.optional(), // EngineQT only — ABSENT for v3/mr (byte-identity)
});
export type Config = z.infer<typeof ConfigSchema>;

/**
 * The selectable scoring engine. `"v3"` is the DEFAULT, committed engine and its
 * outputs stay byte-identical (the `engine` field is OMITTED for v3, never set to
 * the literal `"v3"`). Other engines (`"mr"` = EngineMR, Mikel Rodrigo's method;
 * `"qt"` = EngineQT, the quant profile) are additive PROFILES — a config + shared
 * plug-in analytics on top of the same Databento layer — and stamp their id so the
 * audit identity is the pair `(engine, configVersion)` with no collision. See
 * `lib/engine/profiles.ts`.
 */
export type EngineId = "v3" | "mr" | "qt";

/** A fully-reproducible scored signal row (the audit unit). */
export interface SignalRow {
  pairId: string;
  date: string;
  spread: number;
  z: number;
  seasonFactor: number;
  fundFactor: number;
  volFactor?: number; // v3: volatility-regime factor (audit; optional for backward-compat)
  base: number;
  score: number;
  tier: Tier;
  avoidOverride: boolean;
  configVersion: number;
  engine?: EngineId; // OMITTED for v3 (byte-identical); stamped only for non-default engines
}

/**
 * The as-of view handed to the engine. Already truncated to `date ≤ asOf` and
 * publication-gated (`pubTimestamp ≤ asOf`) by `features/buildAsOf`, so the
 * engine — a pure function of (AsOfView, Config) — structurally cannot see the
 * future. This is the load-bearing type for look-ahead safety.
 */
export interface AsOfView {
  asOf: string;
  prices: PricePoint[];
  funds: FundamentalRelease[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPER ENGINE — universe, seasonality analytics, opportunities, ML seam
// ─────────────────────────────────────────────────────────────────────────────

/** A weighted leg of an instrument (Databento symbol + signed weight). */
export interface InstrumentLeg {
  symbol: string; // continuous (e.g. "LE.c.0") or raw (e.g. "LEM5")
  weight: number; // +1 long, -1 short; fractions for ratio spreads
}

export type InstrumentKind = "outright" | "calendar" | "inter" | "crush" | "seasonal" | "butterfly" | "ratio" | "basis";

/**
 * A fundamental series wired to an instrument (kept for the neutral fundamental
 * factor path; the metals universe wires NONE, so F = 0 and fund_factor = 0).
 * Sign convention: +1 = "a high value justifies a WIDER spread".
 */
export interface FundamentalRef {
  source: string;
  report: string;
  signConvention?: 1 | -1;
  /** Impact-horizon tag (tagging only — never changes the scored F). */
  horizon?: "short" | "medium" | "long";
}

/** A tradable series definition — the unit the super engine analyzes. */
export interface Instrument {
  id: string; // stable key, e.g. "LE.cal.0-1", "LE.crush", or "LE.seas.M-Q"
  label: string;
  product: string; // root, e.g. "GC" (a pair id such as "GS" for relative value)
  /** The asset this instrument belongs to (relative-value instruments are attributed to the pair's numerator). */
  metal?: AssetId;
  kind: InstrumentKind;
  legs: InstrumentLeg[];
  pointValue: number; // $ per 1.0 price move per contract (the "dollar meter")
  dataset: string; // e.g. "GLBX.MDP3"
  stypeIn: string; // "continuous" | "raw_symbol"
  fundamentals?: FundamentalRef[];
}

/**
 * A RESOLVED contract leg behind a decision — the actual contract you would
 * trade for one leg of an instrument, on a given as-of date, after applying the
 * trade direction. `symbol` is the abstract continuous leg ("LE.c.0");
 * `rawSymbol` is the underlying contract on the date ("LEM6"); `instrumentId` is
 * Databento's unique per-contract integer. `rawSymbol` is "" / `instrumentId` 0
 * when it could not be resolved (never synthesize a contract).
 */
export interface ContractLeg {
  symbol: string; // continuous leg symbol, e.g. "LE.c.0"
  rawSymbol: string; // underlying contract on the date, e.g. "LEM6" ("" = unresolved)
  cSymbol?: string; // /c/-page symbol (2-digit year), e.g. "LEM26" — for contract links
  instrumentId: number; // Databento unique per-contract id (0 = unresolved)
  weight: number; // the leg's signed weight from the instrument
  side: "long" | "short"; // after applying the trade direction
}

/**
 * One contiguous date range over which a CONTINUOUS leg (e.g. "LE.c.0") pointed
 * at a single underlying contract (`instrumentId`). `start`/`end` are the first
 * and last dates that contract was the continuous front in the OBSERVED data
 * (the final segment is treated as open-ended forward at resolve time).
 */
export interface LegMapSegment {
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive (last observed date for this run)
  instrumentId: number;
  rawSymbol: string; // "" until resolved via Databento symbology
}

/** The roll history of one continuous leg: which real contract it was, and when. */
export interface LegMap {
  symbol: string; // continuous leg, e.g. "LE.c.0"
  dataset: string; // e.g. "GLBX.MDP3"
  segments: LegMapSegment[]; // chronological, non-overlapping (collapsed id runs)
}

/** One daily OHLCV bar of a SPECIFIC contract (Barchart-style per-contract analytics). */
export interface ContractBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest?: number; // daily settlement open interest (Databento statistics schema)
}

/** A specific contract + its daily bars (e.g. "HEN26" = Lean Hogs Jul 2026). */
export interface ContractSeries {
  symbol: string; // display symbol with 2-digit year, e.g. "HEN26"
  product: string; // root, e.g. "HE"
  month: number; // 1..12
  year: number; // 4-digit
  instrumentId?: number; // Databento contract id, when known
  bars: ContractBar[];
}

/** Per-contract summary (no bars) for listings / the spreads matrix. */
export interface ContractMeta {
  symbol: string;
  product: string;
  month: number;
  year: number;
  firstDate: string;
  lastDate: string;
  barCount: number;
  lastClose: number;
}

/** A single (date, value) observation of an instrument's price/spread series. */
export interface SeriesPoint {
  date: string; // YYYY-MM-DD
  value: number; // $-scaled combined value of the legs
  volume?: number;
}

/** Day-of-year-indexed seasonal curve (index 1..366; 0 unused). */
export interface SeasonalCurve {
  lookbackYears: number | null; // null = all available history
  values: number[]; // length 367
  years: number[]; // calendar years contributing
}

/** Per-day percentile bands across years (each array length 367). */
export interface SeasonalEnvelope {
  percentiles: number[]; // e.g. [10,25,50,75,90]
  bands: Record<number, number[]>; // percentile -> values[367]
  years: number[];
}

/** One calendar year's path, optionally rebased, for overlay charts. */
export interface YearCurve {
  year: number;
  points: { doy: number; value: number }[];
}

/** Per-year realized result of a fixed seasonal window trade. */
export interface SeasonalYearResult {
  year: number;
  entryDate: string;
  exitDate: string;
  pnl: number; // $ per contract (long the instrument)
  mae: number; // max adverse excursion ($, ≤ 0)
  mfe: number; // max favorable excursion ($, ≥ 0)
}

/** Full statistics for a fixed seasonal window (the seasonalgo stat table). */
export interface SeasonalWindowStats {
  entryDoy: number;
  exitDoy: number;
  side: "long" | "short";
  years: number; // sample size
  winRate: number; // fraction of profitable years 0..1
  avgPnl: number; // mean $ P&L
  medianPnl: number;
  stdPnl: number;
  best: SeasonalYearResult | null;
  worst: SeasonalYearResult | null;
  avgMae: number;
  avgMfe: number;
  profitFactor: number; // gross win $ / gross loss $
  tStat: number; // mean / (std/sqrt(n))
  perYear: SeasonalYearResult[];
}

/** ML prediction for one instrument as-of a date (produced by the Python pipeline). */
export interface MlPrediction {
  instrumentId: string;
  date: string;
  pConverge: number; // probability of mean-convergence within horizon, 0..1
  expectedMove: number; // expected $ move per contract
  confidence: number; // 0..1
  validationStatus: "passed" | "failed" | "untested";
}

/** Result of evaluating an ML forecast factor for the convergence score. */
export interface ForecastResult {
  factor: number; // bounded [-1, 1]
  confidence: number; // 0..1
  validationStatus: "passed" | "failed" | "untested";
}

/** A ranked trading opportunity surfaced by the screener. */
export interface Opportunity {
  instrumentId: string;
  label: string;
  asOf: string;
  z: number;
  tier: Tier;
  score: number;
  seasonalWindow: SeasonalWindowStats | null; // active high-conviction window, if any
  aligned: boolean | null; // active window agrees with the z-fade (null = no active window)
  mlProb: number | null;
  expectedMove: number | null;
  compositeRank: number; // higher = stronger; transparent composite
  evidence: string[]; // human-readable reasons
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMENT / ANNOTATION LAYER — Tier 2 (editable, per-(commodity, view) notes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The views an editable note can be attached to. An allowlist so a note key is
 * always `"${product}:${view}"` (or the finer `"${instrumentId}:${view}"`
 * override) and never an arbitrary string. Tier-1 STATIC method notes live in
 * `components/ui/mikelNotes.ts`; this is the editable artifact tier (mirrors the
 * AI research/analysis artifacts — editable without a redeploy via
 * `scripts/load-annotations.ts` or the local-only annotations API).
 */
export const NOTE_VIEWS = [
  "curve",
  "spread",
  "butterfly",
  "seasonal",
  "validation",
  "fundamentals",
  "verdict",
  "capacity",
] as const;
export type NoteView = (typeof NOTE_VIEWS)[number];

/**
 * A set of years flagged as ATYPICAL for seasonality removal (EngineMR #6) —
 * BRANDED so it can only be produced by `atypicalYearsFromRegimes`, which reads
 * frozen, EXOGENOUS shock markers (`REGIME_WINDOWS`) and NEVER the price series.
 * A plain `Set<number>` derived from price behaviour does not satisfy this type,
 * so the circular "delete the years that don't fit the pattern" overfitting trap
 * the spec warns about is a COMPILE ERROR, not a code-review hope.
 */
declare const exogenousYearBrand: unique symbol;
export type ExogenousYearSet = ReadonlySet<number> & { readonly [exogenousYearBrand]: true };

/** An editable, user-authored note keyed by `(product, view)` (optionally per instrument). */
export interface CommodityViewNote {
  product: string; // root, e.g. "LE"
  view: NoteView;
  instrumentId?: string; // optional finer scope, e.g. "LE.cal.0-1"
  title?: string;
  body: string;
  author?: string;
  updatedAt?: string; // ISO; set when persisted
}
