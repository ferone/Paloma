import { fmtDate } from '../design/format'
import { Chip } from './Chip'

export interface ProvenanceProps {
  source: string
  /** ISO date/time of the latest data point. */
  asOf?: string | null
  modeled?: boolean
  note?: string
}

/** "Source · data through 30 Sep 2026" with an optional Modeled chip. */
export function Provenance({ source, asOf, modeled, note }: ProvenanceProps) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted">
      {modeled && <Chip tone="modeled">Modeled</Chip>}
      <span>{source}</span>
      {asOf !== undefined && (
        <>
          <span aria-hidden className="text-faint">·</span>
          <span>{asOf ? `data through ${fmtDate(asOf)}` : 'no data yet'}</span>
        </>
      )}
      {note && (
        <>
          <span aria-hidden className="text-faint">·</span>
          <span>{note}</span>
        </>
      )}
    </p>
  )
}
