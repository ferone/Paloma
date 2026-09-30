import type { OosStatus, QuantTier, VerdictView } from '@shared/quant'
import { Chip, type ChipTone } from '../../../ui'

const TIER_TONE: Record<QuantTier, ChipTone> = { STRONG: 'strong', MODERATE: 'moderate', WATCH: 'watch', AVOID: 'avoid' }

export function TierChip({ tier }: { tier: QuantTier }) {
  return <Chip tone={TIER_TONE[tier]}>{tier.toLowerCase()}</Chip>
}

/** BUY/SELL always says which way; AVOID says stand aside. */
export function ActionChip({ verdict, long }: { verdict: VerdictView; long?: boolean }) {
  const tone: ChipTone = verdict.action === 'BUY' ? 'strong' : verdict.action === 'SELL' ? 'avoid' : 'neutral'
  const label = verdict.action === 'AVOID' ? 'Stand aside' : verdict.action === 'BUY' ? 'Buy · long' : 'Sell · short'
  return (
    <span className="inline-flex flex-col gap-0.5">
      <Chip tone={tone} title={verdict.instruction}>
        {label}
      </Chip>
      {long && <span className="text-2xs text-muted">{verdict.instruction}</span>}
    </span>
  )
}

export function OosChip({ status, fragile }: { status: OosStatus; fragile?: boolean | null }) {
  const tone: ChipTone = status === 'passed' ? (fragile ? 'moderate' : 'strong') : status === 'failed' ? 'avoid' : 'neutral'
  return (
    <Chip tone={tone} title={fragile ? 'Passed, but fails once the documented shock years are dropped' : `Walk-forward out-of-sample: ${status}`}>
      OOS {status}
      {status === 'passed' && fragile ? ' · fragile' : ''}
    </Chip>
  )
}

export function CarryChip({ alignment, conflict }: { alignment: 'aligned' | 'conflict' | 'neutral' | null; conflict?: boolean }) {
  if (!alignment) return <span className="text-2xs text-faint">n/a</span>
  if (conflict || alignment === 'conflict') return <Chip tone="avoid">veto</Chip>
  if (alignment === 'aligned') return <Chip tone="strong">aligned</Chip>
  return <Chip tone="neutral">neutral</Chip>
}

export function GateChip({ ok, label, na }: { ok: boolean | null; label: string; na?: boolean }) {
  if (na || ok === null) return <Chip tone="neutral">{label} n/a</Chip>
  return <Chip tone={ok ? 'strong' : 'avoid'}>{`${label} ${ok ? 'pass' : 'fail'}`}</Chip>
}
