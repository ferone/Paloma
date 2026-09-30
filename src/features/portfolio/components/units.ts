import { UNIVERSE, type AssetId } from '@shared/universe'
import { fmtNum } from '../../../design/format'

/** Quantity with its unit, e.g. "32.148 oz", "1.5000 BTC". Em dash when missing. */
export function fmtQty(n: number | null | undefined, unit: string | null | undefined, digits = 3): string {
  const s = fmtNum(n, digits)
  return unit && n != null && Number.isFinite(n) ? `${s} ${unit}` : s
}

/** Decimals for a quantity of an asset's physical unit: 3 for troy oz, 4 for BTC-like custody balances. */
export function qtyDigits(asset: AssetId | null | undefined): number {
  if (!asset) return 3
  return UNIVERSE[asset].physical?.kind === 'custody' ? 4 : 3
}

export { assetBucketLabel as assetLabel } from '@shared/portfolio'
