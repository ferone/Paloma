import type { Sleeve } from '@shared/portfolio'
import { ASSET_COLOR, PALETTE } from '../../../design/tokens'

export const SLEEVE_COLOR: Record<Sleeve, string> = {
  etf: PALETTE.series[0],
  physical: PALETTE.series[2],
  futures: PALETTE.series[1],
  equity: PALETTE.series[3],
  cash: PALETTE.series[5],
}

/** Colour per allocation bucket: each asset's colour, plus cash and other. */
export const ASSET_BUCKET_COLOR: Record<string, string> = {
  ...ASSET_COLOR,
  cash: PALETTE.series[5],
  other: PALETTE.series[4],
}
