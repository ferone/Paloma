import { fmtNum, fmtPct, fmtUsd } from '../../design/format'
import type { QuantKind } from '@shared/quant'

/** Format a structure value in its own unit ($/oz spreads, ratio points, $ dollar-spread, % rebased). */
export function fmtValue(v: number | null | undefined, unit: string): string {
  if (unit === '%') return v == null ? '—' : `${fmtNum(v, 1)}%`
  if (unit === 'ratio') return fmtNum(v, 2)
  if (unit === '$') return fmtUsd(v, 0)
  return fmtNum(v, Math.abs(v ?? 0) < 1 ? 3 : 2)
}

export function valueFormatter(unit: string): (v: number) => string {
  return (v) => fmtValue(v, unit)
}

export const KIND_LABEL: Record<QuantKind, string> = {
  outright: 'Outright',
  calendar: 'Calendar',
  butterfly: 'Butterfly',
  seasonal: 'Seasonal pair',
  ratio: 'Ratio',
  inter: 'Metal spread',
}

export const fmtWin = (w: number | null | undefined) => fmtPct(w, 0)
