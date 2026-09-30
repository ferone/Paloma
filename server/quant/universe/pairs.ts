import type { Instrument } from "../types/index.js";
import { RELATIVE_VALUE_PAIRS, assetSpec, type AssetId, type AssetSpec, type FuturesProduct, type RelativeValuePair } from "../../../shared/universe.js";

/**
 * Relative-value pairs as DATA: every entry of `RELATIVE_VALUE_PAIRS` becomes a
 * ratio + a dollar spread on the two assets' full-size front futures. Nothing
 * here knows about gold or silver — the numerator/denominator come from the pair
 * and every $ multiplier from each leg's `pointValue`. PURE.
 *
 *   <id>.ratio   num.c0 / den.c0                   quotient (non-linear; built directly)
 *   <id>.spread  +pvNum·num.c0 − pvDen·den.c0      one-contract dollar-notional spread
 *                                                  ($-absorbed weights ⇒ pointValue 1)
 */

export const GLBX = "GLBX.MDP3";

export interface PairLegs {
  pair: RelativeValuePair;
  num: AssetSpec;
  den: AssetSpec;
  /** Full-size front futures product of each leg. */
  numFut: FuturesProduct;
  denFut: FuturesProduct;
}

/** Resolve a pair's legs, or null when either asset has no futures (nothing to build). */
export function pairLegs(pair: RelativeValuePair, lookup: (id: AssetId) => AssetSpec = assetSpec): PairLegs | null {
  const num = lookup(pair.numerator);
  const den = lookup(pair.denominator);
  const numFut = num?.futures[0];
  const denFut = den?.futures[0];
  if (!numFut || !denFut) return null;
  return { pair, num, den, numFut, denFut };
}

const leg = (root: string, n: number) => `${root}.c.${n}`;

/** The ratio + dollar-spread instruments for one pair (attributed to the numerator asset). */
export function pairInstruments(p: PairLegs): Instrument[] {
  const { pair, num, den, numFut, denFut } = p;
  const base = { product: pair.id, metal: pair.numerator, dataset: GLBX, stypeIn: "continuous" } as const;
  return [
    {
      ...base,
      id: `${pair.id}.ratio`,
      label: `${num.label}/${den.label.toLowerCase()} ratio (${numFut.root} ÷ ${denFut.root})`,
      kind: "ratio",
      legs: [
        { symbol: leg(numFut.root, 0), weight: 1 },
        { symbol: leg(denFut.root, 0), weight: -1 },
      ],
      // The ratio is a quotient, not a weighted sum: P&L is booked on a dollar-neutral
      // pair (RATIO_NOTIONAL per leg) through Δln(ratio) — see run/analyze.ts.
      pointValue: 1,
    },
    {
      ...base,
      id: `${pair.id}.spread`,
      label: `${num.label} − ${den.label.toLowerCase()} dollar spread (1 ${numFut.root} vs 1 ${denFut.root})`,
      kind: "inter",
      legs: [
        { symbol: leg(numFut.root, 0), weight: numFut.pointValue },
        { symbol: leg(denFut.root, 0), weight: -denFut.pointValue },
      ],
      pointValue: 1, // weights absorb $/point ⇒ the combined value is already dollars
    },
  ];
}

/** Every pair whose legs resolve (a pair on an asset without futures is skipped). */
export function resolvedPairs(pairs: readonly RelativeValuePair[] = RELATIVE_VALUE_PAIRS): PairLegs[] {
  return pairs.map((p) => pairLegs(p)).filter((p): p is PairLegs => p !== null);
}

export function pairById(id: string): RelativeValuePair | undefined {
  return RELATIVE_VALUE_PAIRS.find((p) => p.id === id);
}

export function pairByKey(key: string): RelativeValuePair | undefined {
  return RELATIVE_VALUE_PAIRS.find((p) => p.key === key);
}

/** Pairs an asset takes part in (its relative-value rows show in that asset's views). */
export function pairsForAsset(asset: AssetId): RelativeValuePair[] {
  return RELATIVE_VALUE_PAIRS.filter((p) => p.numerator === asset || p.denominator === asset);
}

/** True when `product` is a relative-value pair id (e.g. "GS"). */
export function isPairProduct(product: string): boolean {
  return RELATIVE_VALUE_PAIRS.some((p) => p.id === product);
}

/** Does an instrument/opportunity (by asset + product) belong to an asset's view? */
export function belongsToAsset(asset: AssetId, row: { metal?: string; product: string }): boolean {
  return row.metal === asset || pairsForAsset(asset).some((p) => p.id === row.product);
}

/**
 * Denominator contracts per 1 numerator contract for a DOLLAR-NEUTRAL pair at
 * the given front prices: (pNum·pvNum) / (pDen·pvDen). 0 when a price is missing.
 */
export function dollarNeutralHedge(numPrice: number, denPrice: number, legs: Pick<PairLegs, "numFut" | "denFut">): number {
  if (!numPrice || !denPrice) return 0;
  return (numPrice * legs.numFut.pointValue) / (denPrice * legs.denFut.pointValue);
}
