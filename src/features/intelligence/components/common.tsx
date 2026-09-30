import type { ValidationStatus } from '@shared/ml'
import { Chip, type ChipTone } from '../../../ui'

const TONE: Record<ValidationStatus, ChipTone> = { passed: 'strong', failed: 'avoid', untested: 'neutral' }

/** PASSED / FAILED / UNTESTED chip; the first gate reason rides along as text. */
export function ValidationChip({ status, reasons }: { status: ValidationStatus | null; reasons?: string[] }) {
  if (!status) return <Chip tone="neutral">No run</Chip>
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Chip tone={TONE[status]} title={reasons?.join('; ')}>{status}</Chip>
      {reasons && reasons.length > 0 && <span className="num text-2xs text-muted">{reasons[0]}</span>}
    </span>
  )
}
