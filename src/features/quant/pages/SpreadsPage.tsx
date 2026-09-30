import { Link } from 'react-router-dom'
import { useState } from 'react'
import type { InstrumentListItem } from '@shared/quant'
import { UNIVERSE } from '@shared/universe'
import { Panel, Segmented } from '../../../ui'
import { useInstrument, useInstruments } from '../api'
import { QuantQuery } from '../components/QuantQuery'
import { CurvaturePanel, SignalStats, StructuralPanel, ZBandPanel } from '../components/InstrumentPanels'
import { WhyVerdict } from '../components/WhyVerdict'
import { useQuantContext } from '../QuantLayout'

/** Calendars and butterflies for the metal in focus: z-bands, curvature and the structural gate. */
export default function SpreadsPage() {
  const { metal } = useQuantContext()
  const list = useInstruments(metal)
  return (
    <QuantQuery q={list}>
      {(items) => <Spreads key={metal} items={items} root={UNIVERSE[metal].futures[0].root} />}
    </QuantQuery>
  )
}

function Spreads({ items, root }: { items: InstrumentListItem[]; root: string }) {
  const { mode } = useQuantContext()
  const options = items.filter((i) => i.id.startsWith(`${root}.`) && (i.kind === 'calendar' || i.kind === 'butterfly'))
  const [id, setId] = useState(options.find((o) => o.kind === 'butterfly')?.id ?? options[0]?.id ?? '')
  const q = useInstrument(id || undefined)
  if (options.length === 0) {
    return (
      <Panel>
        <p className="py-8 text-center text-sm text-muted">No calendar or butterfly could be built for {root} — the stored history needs at least three consecutive active contracts.</p>
      </Panel>
    )
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<string>
          ariaLabel="Structure"
          size="md"
          value={id}
          onChange={setId}
          options={options.map((o) => ({ value: o.id, label: o.id.replace(`${root}.`, '').replace('cal.', 'Calendar ').replace('fly.', 'Fly ') }))}
        />
        {id && (
          <Link to={`/quant/i/${encodeURIComponent(id)}`} className="text-xs text-brand underline underline-offset-2">
            Full analysis & trade ticket →
          </Link>
        )}
      </div>
      <QuantQuery q={q} rows={8}>
        {(d) => (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <ZBandPanel d={d} />
              <CurvaturePanel d={d} />
              <StructuralPanel d={d} />
            </div>
            <div className="space-y-4">
              <SignalStats d={d} />
              <WhyVerdict d={d} mode={mode} />
            </div>
          </div>
        )}
      </QuantQuery>
    </div>
  )
}
