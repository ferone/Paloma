import type { ReportKind } from '@shared/ai'
import { fmtNum } from '../../../design/format'

export const KIND_LABEL: Record<ReportKind, string> = {
  macro_brief: 'Macro brief',
  trade_brief: 'Trade brief',
  portfolio_commentary: 'Portfolio commentary',
  ask: 'Question',
}

/** OpenRouter-reported USD cost; sub-cent values keep four decimals. */
export function fmtCost(v: number | null | undefined): string {
  if (v == null) return '—'
  return v < 0.01 ? `$${fmtNum(v, 4)}` : `$${fmtNum(v, 3)}`
}

/** "anthropic/claude-sonnet-4.6:online" → "claude-sonnet-4.6" (provider and :online shown separately). */
export function shortModel(id: string): string {
  return id.replace(/:online$/i, '').split('/').pop() ?? id
}
