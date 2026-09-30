/**
 * Structure liquidity (EngineMR — Mikel's method #2, with the spec's push-back).
 *
 * Exchange-traded calendar spreads & butterflies usually trade as their OWN Globex
 * instruments with their OWN volume/OI (implied matching) — so the caller ALWAYS
 * tries the native combo figure first (see `lib/data/combo.ts` +
 * `scripts/probe-combo-volume.ts`). Only when an exchange genuinely doesn't
 * disseminate a combo's liquidity do we fall back to a proxy, and we are explicit
 * that it is one: the MIN across the legs (a structure is only as tradable as its
 * tightest leg), NEVER the sum (which overstates), labelled "synthetic liquidity
 * proxy (min-of-legs)", and used for ranking/filtering only — never shown as OI. PURE.
 */
export const SYNTHETIC_LIQUIDITY_LABEL = "synthetic liquidity proxy (min-of-legs)";

export interface StructureLiquidity {
  value: number; // contracts/day (native volume, or the min-leg proxy)
  isSynthetic: boolean; // true = proxy, must be labelled and never shown as OI
  label: string; // human-facing provenance
}

/** The honest proxy: the tightest leg. Empty/invalid input → 0 (unknown, synthetic). */
export function minLegLiquidity(legVolumes: number[]): StructureLiquidity {
  const valid = legVolumes.filter((v) => Number.isFinite(v) && v >= 0);
  const value = valid.length ? Math.min(...valid) : 0;
  return { value, isSynthetic: true, label: SYNTHETIC_LIQUIDITY_LABEL };
}

/**
 * Native-first liquidity: if the combo's own volume is present (> 0), use it as REAL
 * exchange data; otherwise fall back to the clearly-labelled min-leg proxy. PURE.
 */
export function structureLiquidity(nativeVolume: number | null | undefined, legVolumes: number[]): StructureLiquidity {
  if (nativeVolume != null && Number.isFinite(nativeVolume) && nativeVolume > 0) {
    return { value: nativeVolume, isSynthetic: false, label: "native combo volume" };
  }
  return minLegLiquidity(legVolumes);
}
