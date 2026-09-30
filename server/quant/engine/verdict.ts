import type { Config } from "../types/index.js";

/**
 * The DECISION layer: turn the engine's signals into a clear BUY / AVOID verdict
 * with listed reasoning. PURE (engine layer, types only) so the future
 * point-in-time simulation engine can replay it at any past as-of date.
 *
 * Two modes the user can toggle:
 *  - **conservative** (default): only BUY an edge proven OUT-OF-SAMPLE and
 *    currently favorable. Never says BUY on an unvalidated in-sample score.
 *  - **aggressive**: BUY on the live convergence signal alone; OOS + ML are shown
 *    as context, not required. More trades, more risk.
 *
 * Inputs are primitives (not `SignalRow`/`ValidationSummary`) to keep the engine
 * decoupled from persistence; `maturity` + present price are composed by the
 * caller (which knows the registry/spec).
 */
export type VerdictMode = "conservative" | "aggressive";
export type Verdict = "BUY" | "AVOID";
export type ValStatus = "passed" | "failed" | "untested";

export interface VerdictSignal {
  z: number;
  score: number;
  avoidOverride: boolean;
}
export interface VerdictInput {
  signal: VerdictSignal;
  validationStatus?: ValStatus;
  /** Active seasonal window covering "today" and whether it agrees with the z-fade. */
  seasonal?: { active: boolean; agrees: boolean } | null;
  ml?: { validationStatus: ValStatus; pConverge: number } | null;
  /**
   * Regime-robustness of the OOS edge: `false` = the walk-forward pass does NOT
   * survive dropping the tracked macro-shock years (2011 silver, 2013 taper, 2020 EFP, 2021 squeeze, 2025 tariff/London) —
   * i.e. the edge is likely anomaly-driven. A regime-FRAGILE passed edge is NOT a
   * conservative BUY (the system should not BUY something it itself flags as
   * anomaly-driven). `undefined`/`true` ⇒ no effect.
   */
  survivesRegime?: boolean;
  /**
   * EngineMR (#6, risk half): the CURRENT period is itself in a structural move
   * (the spread/outright is breaking out of its own noise band) — deviating like an
   * atypical year right now. `true` ⇒ stand aside in conservative mode (don't trade
   * into a regime-off market). `undefined`/`false` ⇒ no effect.
   */
  regimeOff?: boolean;
  /**
   * EngineQT: OU tradability gate — `false` = the spread shows no exploitable
   * mean-reversion structure (AR(1) not reverting / half-life out of bounds), so
   * the z-fade has no engine: conservative blocker. `undefined`/`true` ⇒ no effect.
   */
  ouTradable?: boolean;
  /**
   * EngineQT: carry trend veto — `true` = the curve slope is in structural motion;
   * never fade a trending curve: conservative blocker. `undefined`/`false` ⇒ no effect.
   */
  carryConflict?: boolean;
}
export interface VerdictResult {
  verdict: Verdict;
  mode: VerdictMode;
  reasons: string[]; // criteria satisfied / context
  blockers: string[]; // for AVOID: what is missing for a BUY
  confidence: "high" | "medium" | "low";
}

export function decideVerdict(input: VerdictInput, mode: VerdictMode, cfg: Config): VerdictResult {
  const { signal, validationStatus = "untested", seasonal = null, ml = null, survivesRegime, regimeOff, ouTradable, carryConflict } = input;
  const reasons: string[] = [];
  const blockers: string[] = [];
  const score = Math.round(signal.score);
  // A passed OOS edge that does NOT survive regime exclusion is likely anomaly-driven.
  const regimeFragile = validationStatus === "passed" && survivesRegime === false;

  let buy: boolean;
  if (mode === "conservative") {
    const okValid = validationStatus === "passed";
    const okScore = signal.score >= cfg.tiers.moderate;
    const okNotAvoid = !signal.avoidOverride;
    const okSeasonal = !seasonal || !seasonal.active || seasonal.agrees;
    const okRegime = !regimeFragile && !regimeOff;
    // EngineQT gates (undefined = lens absent = no effect; v3/mr byte-identical).
    const okOu = ouTradable !== false;
    const okCarry = carryConflict !== true;

    if (okValid) reasons.push("edge is OOS-validated (walk-forward passed)");
    else blockers.push(`edge not OOS-validated (status: ${validationStatus})`);
    if (okScore) reasons.push(`convergence score ${score} ≥ MODERATE (${cfg.tiers.moderate})`);
    else blockers.push(`convergence score ${score} below MODERATE (${cfg.tiers.moderate})`);
    if (okNotAvoid) reasons.push("no AVOID override (move is not both calendar-aligned and fundamentally justified)");
    else blockers.push("AVOID override: the deviation runs WITH the calendar and is fundamentally justified");
    if (seasonal?.active) {
      if (seasonal.agrees) reasons.push("active seasonal window agrees with the mean-reversion direction");
      else blockers.push("active seasonal window CONFLICTS with the mean-reversion direction");
    }
    if (regimeFragile) blockers.push("OOS edge is regime-FRAGILE — it fails once the tracked macro-shock years (2011 silver, 2013 taper, 2020 EFP, 2021 squeeze, 2025 tariff/London) are dropped (likely anomaly-driven)");
    if (regimeOff) blockers.push("regime-OFF — the current period is itself in a structural move (breaking its own noise band); stand aside until it normalizes");
    if (ouTradable === true) reasons.push("OU half-life within bounds — mean-reversion structure present");
    if (!okOu) blockers.push("no mean-reversion structure (OU half-life out of bounds) — the z-fade has no engine");
    if (!okCarry) blockers.push("carry veto: the curve slope is trending — don't fade a trending curve");
    if (ml?.validationStatus === "passed") reasons.push(`ML (validated): p(converge) ${Math.round(ml.pConverge * 100)}%`);

    buy = okValid && okScore && okNotAvoid && okSeasonal && okRegime && okOu && okCarry;
  } else {
    const okScore = signal.score >= cfg.tiers.watch;
    const okNotAvoid = !signal.avoidOverride;

    if (okScore) reasons.push(`convergence score ${score} ≥ WATCH (${cfg.tiers.watch}) — signal mode`);
    else blockers.push(`convergence score ${score} below WATCH (${cfg.tiers.watch})`);
    if (okNotAvoid) reasons.push("no AVOID override");
    else blockers.push("AVOID override active");
    // OOS + ML (and the QT lenses when present) are context here, never blockers.
    reasons.push(
      `context — OOS: ${validationStatus}` +
        (ml ? `; ML ${ml.validationStatus} (p=${Math.round(ml.pConverge * 100)}%)` : "") +
        (ouTradable === false ? "; OU: no reversion structure" : "") +
        (carryConflict === true ? "; carry: trending curve" : ""),
    );

    buy = okScore && okNotAvoid;
  }

  const verdict: Verdict = buy ? "BUY" : "AVOID";
  let confidence: VerdictResult["confidence"];
  if (buy) {
    const strong = signal.score >= cfg.tiers.strong;
    confidence =
      mode === "conservative"
        ? strong
          ? "high"
          : "medium"
        : validationStatus === "passed"
          ? "medium"
          : "low";
  } else {
    confidence = signal.avoidOverride ? "high" : "medium";
  }

  return { verdict, mode, reasons, blockers, confidence };
}

/**
 * Verdict for a ROLL-CLEAN SEASONAL instrument. Its z-score is meaningless
 * (gappy series), so the decision is driven by the OUT-OF-SAMPLE validation of
 * its seasonal window + whether "today" is inside that window — not by `score`.
 *  - conservative: BUY only when the window is OOS-validated AND we are inside it.
 *  - aggressive: BUY whenever the window is OOS-validated (even ahead of the
 *    exact entry date, flagged). PURE.
 */
export interface SeasonalVerdictInput {
  validationStatus: ValStatus;
  inWindow: boolean;
  windowSide: "long" | "short" | null;
  /** See `VerdictInput.survivesRegime` — `false` = anomaly-driven OOS pass; not a conservative BUY. */
  survivesRegime?: boolean;
}
export function decideSeasonalVerdict(input: SeasonalVerdictInput, mode: VerdictMode): VerdictResult {
  const { validationStatus, inWindow, windowSide, survivesRegime } = input;
  const reasons: string[] = [];
  const blockers: string[] = [];
  const validated = validationStatus === "passed";
  // A passed window that fails when the shock years are dropped is likely anomaly-driven.
  const regimeFragile = validated && survivesRegime === false;

  if (validated) reasons.push("seasonal edge is OOS-validated (walk-forward passed)");
  else blockers.push(`seasonal edge not OOS-validated (status: ${validationStatus})`);
  if (inWindow) reasons.push(`currently INSIDE the validated ${windowSide ?? ""} window`.trim());
  else blockers.push("outside the validated seasonal window — wait for the entry date");
  if (regimeFragile) blockers.push("OOS edge is regime-FRAGILE — it fails once the tracked macro-shock years (2011 silver, 2013 taper, 2020 EFP, 2021 squeeze, 2025 tariff/London) are dropped (likely anomaly-driven), so the conservative rule abstains");

  // Conservative will not BUY an anomaly-driven (regime-fragile) edge, even passed + in-window.
  const buy = mode === "conservative" ? validated && inWindow && !regimeFragile : validated;
  const verdict: Verdict = buy ? "BUY" : "AVOID";
  const confidence: VerdictResult["confidence"] = buy
    ? regimeFragile
      ? "low"
      : inWindow
        ? "high"
        : "medium"
    : validated
      ? "medium"
      : "high";
  return { verdict, mode, reasons, blockers, confidence };
}

/**
 * Map the PERSISTED seasonal window of an instrument into the inputs the verdict
 * layer needs, so the home cards (`loadVerdicts`) and the instrument detail page
 * (`buildInstrumentView`) derive an IDENTICAL verdict at the live date — they used
 * to read the window from different sources (the OOS edge vs a fresh, differently
 * parameterized `findSeasonalWindows` recompute) and could disagree (BUY vs AVOID).
 *
 * Two shapes, by instrument kind:
 *  - **seasonal**: test `todayDoy` membership against the OOS-validated edge window.
 *  - **convergence** (else): `oppWindow` is ALREADY the active-today window (the
 *    opportunity builder computed membership at the live date), so it is "active"
 *    whenever present, and `agrees` is the persisted `oppAligned`.
 *
 * PURE (engine layer, primitives only). Past-date (scrubbing) reconstructions must
 * NOT use this — the persisted artifacts are present-day and not point-in-time safe.
 */
export interface PersistedWindow {
  entryDoy: number;
  exitDoy: number;
  side: "long" | "short";
}
export interface LiveVerdictInputs {
  /** Window to render in the verdict's contract/timing text (`maturityFor`). */
  win: { entryDoy: number; exitDoy: number; side: string } | null;
  /** `decideSeasonalVerdict.inWindow` (seasonal kind only). */
  seasonalInWindow: boolean;
  /** `decideSeasonalVerdict.windowSide` (seasonal kind only). */
  windowSide: "long" | "short" | null;
  /** `decideVerdict.seasonal` (convergence kind only). */
  convSeasonal: { active: boolean; agrees: boolean } | null;
}
export function liveVerdictWindow(
  kind: string,
  todayDoy: number,
  edgeWindow: PersistedWindow | null,
  oppWindow: PersistedWindow | null,
  oppAligned: boolean | null,
): LiveVerdictInputs {
  if (kind === "seasonal") {
    const win = edgeWindow && edgeWindow.entryDoy > 0 ? { ...edgeWindow } : null;
    const seasonalInWindow = !!win && todayDoy >= win.entryDoy && todayDoy <= win.exitDoy;
    return { win, seasonalInWindow, windowSide: edgeWindow?.side ?? null, convSeasonal: null };
  }
  const win = oppWindow ? { ...oppWindow } : null;
  return {
    win,
    seasonalInWindow: false,
    windowSide: null,
    convSeasonal: win ? { active: true, agrees: oppAligned ?? false } : null,
  };
}

/**
 * Recast a BUY/AVOID decision + the trade DIRECTION into the user-facing action a
 * human actually places: a LONG trade reads "BUY" (go long the spread), a SHORT
 * trade reads "SELL" (go short the spread), and AVOID = stand aside. Presentational
 * mapping ONLY — the underlying BUY/AVOID decision is unchanged; this just keeps a
 * "BUY" from being mistaken for "go long" when the validated edge is actually a short.
 */
export type VerdictAction = "BUY" | "SELL" | "AVOID";
export function verdictAction(verdict: Verdict, direction: "long" | "short" | null): VerdictAction {
  if (verdict === "AVOID") return "AVOID";
  return direction === "short" ? "SELL" : "BUY";
}
