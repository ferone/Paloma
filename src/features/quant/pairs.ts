import { RELATIVE_VALUE_PAIRS, UNIVERSE, type AssetId, type FuturesProduct, type RelativeValuePair } from '@shared/universe'

/** A relative-value pair with both legs' full-size front futures resolved from the universe. */
export interface ClientPair {
  pair: RelativeValuePair
  numLabel: string
  denLabel: string
  numFut: FuturesProduct
  denFut: FuturesProduct
}

function resolve(pair: RelativeValuePair): ClientPair | null {
  const numFut = UNIVERSE[pair.numerator].futures[0]
  const denFut = UNIVERSE[pair.denominator].futures[0]
  if (!numFut || !denFut) return null
  return { pair, numLabel: UNIVERSE[pair.numerator].label, denLabel: UNIVERSE[pair.denominator].label, numFut, denFut }
}

/** Pairs the asset takes part in (and that have futures on both legs). */
export function pairsForAsset(asset: AssetId): ClientPair[] {
  return RELATIVE_VALUE_PAIRS.filter((p) => p.numerator === asset || p.denominator === asset)
    .map(resolve)
    .filter((p): p is ClientPair => p !== null)
}

export function pairByKey(key: string): ClientPair | null {
  const p = RELATIVE_VALUE_PAIRS.find((x) => x.key === key)
  return p ? resolve(p) : null
}

/** Short "gold/silver" style name of the asset's pairs, for copy such as "Gold + gold/silver". */
export function pairNames(asset: AssetId): string[] {
  return pairsForAsset(asset).map((p) => `${p.numLabel.toLowerCase()}/${p.denLabel.toLowerCase()}`)
}
