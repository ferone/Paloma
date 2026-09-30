import type { Config, EngineId } from "../types/index.js";
import { DEFAULT_CONFIG } from "./config.js";

/**
 * Engine profiles — the "selectable engine" mechanism. An engine is NOT a fork:
 * it is a named PROFILE (a `Config` + a set of plug-in toggles + an alignment
 * mode) layered on the SAME pure scoring core and the SAME Databento data. The
 * default engine `"v3"` is byte-identical to before (its `Config` is the untouched
 * `DEFAULT_CONFIG`); other engines add behaviour via shared plug-in modules gated
 * by `profile.plugins`, composed DOWNSTREAM of the score (opportunities / verdict /
 * app), so look-ahead safety and the v3 output are preserved.
 *
 * See `commodity-futures-engine_EngineMR-phase.md` + `MRPlan.md` for EngineMR and
 * `FableMasterPlan.md` Phase C for EngineQT (the quant profile).
 */

/**
 * Plug-in analytics, each a toggle gating a shared PURE module. The first 7 are
 * EngineMR's; the last 4 are EngineQT's (OU tradability, carry curve, the
 * full-universe scanner, and the portfolio layer) — all default FALSE so v3
 * stays byte-identical and MR unchanged.
 */
export interface EnginePlugins {
  /** Butterfly mean-reversion on a contango-aware curve, gated by a regime filter. */
  flies: boolean;
  /** Native-combo-volume-first liquidity; labelled min-of-legs proxy only as fallback. */
  syntheticLiquidity: boolean;
  /** Expiry-week alignment as an ADDITIONAL seasonal lens (continuous stays). */
  expiryWeekAlign: boolean;
  /** Convergence-vs-directional seasonality with the band-crossing window requirement. */
  convergenceBands: boolean;
  /** Fundamental KPIs grouped by impact horizon (tagging only; F blend unchanged). */
  kpiHorizons: boolean;
  /** Act on the ex-atypical-year seasonality (only from frozen exogenous markers). */
  atypicalRemoval: boolean;
  /** Batch / prior-day-settle scanning workflow (real-time path stays available). */
  batchSettle: boolean;
  /** EngineQT: OU fit → half-life tradability gate + adaptive-lookback z. */
  ouAdaptive: boolean;
  /** EngineQT: derived c0/c1/c2 curve — carry tag + trending-curve veto. */
  carryCurve: boolean;
  /** EngineQT: full-universe cross-sectional composite ranking (the scanner). */
  qtScanner: boolean;
  /** EngineQT: correlation-aware selection + vol-target sizing artifact. */
  portfolio: boolean;
}

/** How cross-year series are aligned for seasonal comparison. */
export type AlignmentMode = "continuous" | "expiry-week";

/** A fully-described, user-selectable engine. */
export interface EngineProfile {
  id: EngineId;
  label: string;
  /** Short pill label for the header switcher. */
  shortLabel: string;
  description: string;
  config: Config;
  plugins: EnginePlugins;
  alignmentMode: AlignmentMode;
}

const NO_PLUGINS: EnginePlugins = {
  flies: false,
  syntheticLiquidity: false,
  expiryWeekAlign: false,
  convergenceBands: false,
  kpiHorizons: false,
  atypicalRemoval: false,
  batchSettle: false,
  ouAdaptive: false,
  carryCurve: false,
  qtScanner: false,
  portfolio: false,
};

/**
 * EngineMR's config. Shares the calibrated convergence knobs with v3 (the base
 * math is the same pure core), but carries its OWN version lineage starting at 1
 * so its audit identity is the pair `("mr", configVersion)` — never colliding with
 * v3's `configVersion: 3`. DEFAULT_CONFIG is NOT mutated (we spread a copy).
 */
export const MR_CONFIG: Config = {
  ...DEFAULT_CONFIG,
  version: 1,
};

/**
 * EngineQT's config: the calibrated convergence core + the `qt` parameter block
 * (OU bounds, carry windows, FIXED rank weights, portfolio risk knobs). Own
 * version lineage → audit identity `("qt", 1)`. Every constant is documented in
 * `QtParamsSchema` (lib/types) and was chosen a priori — never fitted to P&L.
 */
export const QT_CONFIG: Config = {
  ...DEFAULT_CONFIG,
  version: 1,
  qt: {
    ou: { window: 252, minObs: 120, halfLifeMin: 5, halfLifeMax: 60, adaptiveK: 3, nMin: 20, nMax: 120 },
    carry: { pctWindow: 756, momWindow: 20, trendZ: 2, flatEps: 0.001 },
    rank: { tradabilityBonus: 25, carryBonus: 15, oosBonus: 20, mlBonus: 20, gateDamp: 0.25 },
    portfolio: { corrWindow: 120, corrMax: 0.6, maxPositions: 8, maxPerProduct: 2, perTradeRisk: 1000 },
  },
};

/** The engine registry. v3 first (default). */
export const ENGINE_PROFILES: Record<EngineId, EngineProfile> = {
  v3: {
    id: "v3",
    label: "v3 — convergence engine",
    shortLabel: "v3",
    description:
      "The committed default: calendar-spread mean-reversion confirmed by seasonality, not contradicted by fundamentals (none wired for metals), dampened in volatility blow-ups.",
    config: DEFAULT_CONFIG,
    plugins: { ...NO_PLUGINS },
    alignmentMode: "continuous",
  },
  mr: {
    id: "mr",
    label: "EngineMR — Mikel's method",
    shortLabel: "MR",
    description:
      "Mikel Rodrigo's profile on the same data: butterfly reversion with a regime filter, expiry-week alignment, convergence-band seasonality, KPI horizons, and frozen-marker atypical-year removal — all additive, all guard-railed.",
    config: MR_CONFIG,
    plugins: {
      ...NO_PLUGINS,
      flies: true,
      syntheticLiquidity: true,
      expiryWeekAlign: true,
      convergenceBands: true,
      kpiHorizons: true,
      atypicalRemoval: true,
      batchSettle: true,
    },
    alignmentMode: "expiry-week",
  },
  qt: {
    id: "qt",
    label: "EngineQT — quant profile",
    shortLabel: "QT",
    description:
      "OU half-life tradability, carry/term-structure corroboration with a trending-curve veto, full-universe cross-sectional ranking, and a correlation-aware, vol-targeted portfolio — all additive gates on the same pure core.",
    config: QT_CONFIG,
    plugins: {
      ...NO_PLUGINS,
      // Reuse the MR plumbing that is genuinely engine-agnostic risk discipline:
      flies: true,
      syntheticLiquidity: true,
      batchSettle: true,
      atypicalRemoval: true,
      // QT analytics:
      ouAdaptive: true,
      carryCurve: true,
      qtScanner: true,
      portfolio: true,
      // MR-identity lenses stay off (expiryWeekAlign/convergenceBands/kpiHorizons).
    },
    alignmentMode: "continuous",
  },
};

/** The default engine id. v3 stays the default everywhere. */
export const DEFAULT_ENGINE: EngineId = "v3";

/** Type-guard: is this a known engine id? */
export function isEngine(id: string | null | undefined): id is EngineId {
  return id === "v3" || id === "mr" || id === "qt";
}

/**
 * The engine to compare against by default: non-default engines compare against
 * v3; v3 compares against the newest profile (qt).
 */
export function altEngineFor(id: EngineId): EngineId {
  return id === "v3" ? "qt" : "v3";
}

/** Resolve a profile by id; unknown / missing → the default (v3) profile. */
export function getProfile(id: string | null | undefined): EngineProfile {
  return isEngine(id) ? ENGINE_PROFILES[id] : ENGINE_PROFILES[DEFAULT_ENGINE];
}
