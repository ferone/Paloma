import type { CotReportFamily } from '@shared/macro'
import type { ChipTone } from '../../ui'

/**
 * Contrarian reading of the speculator percentile (mirrors cotStance in
 * server/macro/scorecard.ts). For the TFF report (CME bitcoin) the reading is
 * informational: leveraged funds are structurally net short because they
 * hedge the cash-and-carry basis trade, so their net is not a directional call.
 */
export function cotStanceLabel(pct: number | null, report: CotReportFamily = 'disagg', netPctOi: number | null = null): { label: string; tone: ChipTone } {
  if (pct == null) return { label: 'Percentile n/a', tone: 'neutral' }
  if (report === 'tff') return { label: netPctOi != null && netPctOi < 0 ? 'Net short · basis hedges' : 'Informational', tone: 'neutral' }
  if (pct >= 0.85) return { label: 'Crowded long · headwind', tone: 'avoid' }
  if (pct <= 0.15) return { label: 'Washed out · tailwind', tone: 'strong' }
  return { label: 'Neutral positioning', tone: 'neutral' }
}
