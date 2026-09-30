import { clamp } from "./math.js";
import type { ForecastResult, MlPrediction } from "../types/index.js";

/**
 * The ML seam (gated). An offline Python model writes `MlPrediction`s into the
 * store; this turns one into a bounded score multiplier — but ONLY when the
 * model has passed walk-forward validation. Until then it is neutral (×1.0), so
 * an unvalidated model can be observed without ever touching a live score.
 *
 * factor = clamp(2·(pConverge − 0.5), −1, 1)   (p=0.5→0, p=1→+1, p=0→−1)
 * multiplier = 1 + 0.2·factor  ∈ [0.8, 1.2], neutral 1.0 at p=0.5.
 * PURE.
 */
export function forecastResult(ml: MlPrediction | null | undefined): ForecastResult {
  if (!ml) return { factor: 0, confidence: 0, validationStatus: "untested" };
  return {
    factor: clamp(2 * (ml.pConverge - 0.5), -1, 1),
    confidence: ml.confidence,
    validationStatus: ml.validationStatus,
  };
}

/** Gated multiplier: 1.0 (no effect) unless the model passed validation. */
export function forecastMultiplier(ml: MlPrediction | null | undefined): number {
  if (!ml || ml.validationStatus !== "passed") return 1;
  return 1 + 0.2 * forecastResult(ml).factor;
}

/** Apply the gated ML factor to a convergence score. */
export function applyForecast(score: number, ml: MlPrediction | null | undefined): number {
  return Number((score * forecastMultiplier(ml)).toFixed(4));
}
