import type { ChipTone } from '../../ui'

/** Contrarian reading of the managed-money percentile (mirrors server/macro/scorecard.ts). */
export function cotStanceLabel(pct: number | null): { label: string; tone: ChipTone } {
  if (pct == null) return { label: 'Percentile n/a', tone: 'neutral' }
  if (pct >= 0.85) return { label: 'Crowded long · headwind', tone: 'avoid' }
  if (pct <= 0.15) return { label: 'Washed out · tailwind', tone: 'strong' }
  return { label: 'Neutral positioning', tone: 'neutral' }
}
