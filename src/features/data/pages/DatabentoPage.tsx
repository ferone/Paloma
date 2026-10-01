import { useState } from 'react'
import { futuresProduct } from '@shared/universe'
import { DATABENTO_ROOTS, DATABENTO_SCHEMAS, type CostEstimate, type DatabentoRoot, type DatabentoSchema } from '@shared/marketdata'
import { fmtAge, fmtDate, fmtUsd } from '../../../design/format'
import { Button, Chip, DataTable, ErrorNote, Explainer, Field, Input, NotConfiguredState, Panel, PanelSkeleton, Stat, isNotConfigured, type Column } from '../../../ui'
import { JobProgress } from '../JobProgress'
import { OpenInterestNote } from '../OpenInterestNote'
import { errorMessage, useBackfill, useDatabentoStatus, useEstimate, type BackfillOutcome } from '../api'

const SCHEMA_LABEL: Record<DatabentoSchema, { label: string; detail: string }> = {
  'ohlcv-1d': { label: 'Daily OHLCV', detail: 'open, high, low, close, volume per contract' },
  statistics: { label: 'Open interest', detail: 'statistics schema, stat_type 9' },
}

/** Spending cap sent with a confirmed backfill: the estimate plus 10% for drift, rounded up to the cent. */
function capFor(total: number): number {
  return Math.ceil(total * 1.1 * 100 + 1) / 100
}

function usd(n: number): string {
  return n < 0.01 ? fmtUsd(n, 4) : fmtUsd(n, 2)
}

const costColumns: Column<CostEstimate['lines'][number]>[] = [
  { key: 'root', header: 'Root', cell: (l) => <span className="num font-medium">{l.root}</span> },
  { key: 'name', header: 'Product', cell: (l) => <span className="text-muted">{futuresProduct(l.root)?.name ?? l.root}</span> },
  { key: 'schema', header: 'Schema', cell: (l) => SCHEMA_LABEL[l.schema].label },
  { key: 'cost', header: 'Cost', numeric: true, cell: (l) => usd(l.cost) },
]

export default function DatabentoPage() {
  const status = useDatabentoStatus()
  const estimate = useEstimate()
  const backfill = useBackfill()

  const [roots, setRoots] = useState<DatabentoRoot[]>([DATABENTO_ROOTS[0]])
  const [schemas, setSchemas] = useState<DatabentoSchema[]>(['ohlcv-1d', 'statistics'])
  const [start, setStart] = useState('2010-06-06')
  const [end, setEnd] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [outcome, setOutcome] = useState<BackfillOutcome | null>(null)

  const running = status.data?.backfill?.state === 'running'

  const est = estimate.data && !isNotConfigured(estimate.data) ? estimate.data : null
  const resetEstimate = () => {
    estimate.reset()
    setConfirming(false)
    setAcknowledged(false)
    setOutcome(null)
  }
  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  if (status.isLoading) return <Panel><PanelSkeleton rows={6} /></Panel>
  if (status.error) return <ErrorNote error={status.error} onRetry={() => status.refetch()} />
  const s = status.data!
  if (!s.configured) {
    return (
      <Panel>
        <NotConfiguredState
          info={{
            status: 'not_configured',
            missing: ['DATABENTO_API_KEY'],
            message: `Databento supplies CME contract history for ${DATABENTO_ROOTS.join(', ')}: every contract month, daily bars and open interest.`,
          }}
        />
      </Panel>
    )
  }

  const invalid = !roots.length || !schemas.length || !start || (!!end && end <= start)
  const cap = est ? capFor(est.total) : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-4">
        <Stat size="sm" label="Budget per pull" value={fmtUsd(s.budget)} hint="DATABENTO_BUDGET; larger pulls need explicit confirmation" />
        <Stat size="sm" label="Spent to date" value={usd(s.spend.totalUsd)} hint="Sum of pre-pull estimates" />
        <Stat size="sm" label="Paid pulls" value={s.spend.pulls} hint={s.spend.lastPullAt ? `last ${fmtAge(s.spend.lastPullAt)}` : 'none yet'} />
        <Stat size="sm" label="History from" value={<span className="text-base">{fmtDate(s.historyStart)}</span>} hint="GLBX.MDP3 licensed start" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Backfill contract history" eyebrow="GLBX.MDP3 · parent symbology" density="dense" provenance={{ source: 'Cost from Databento metadata.get_cost (free, nothing downloaded)' }}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!invalid) {
                resetEstimate()
                estimate.mutate({ roots, schemas, start, end: end || undefined })
              }
            }}
          >
            <fieldset>
              <legend className="label mb-1.5">Roots</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {DATABENTO_ROOTS.map((r) => (
                  <label key={r} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-brand"
                      checked={roots.includes(r)}
                      onChange={() => {
                        setRoots(toggle(roots, r))
                        resetEstimate()
                      }}
                    />
                    <span className="num font-medium">{r}</span>
                    <span className="text-xs text-muted">{futuresProduct(r)?.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label mb-1.5">Schemas</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {DATABENTO_SCHEMAS.map((sc) => (
                  <label key={sc} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-brand"
                      checked={schemas.includes(sc)}
                      onChange={() => {
                        setSchemas(toggle(schemas, sc))
                        resetEstimate()
                      }}
                    />
                    {SCHEMA_LABEL[sc].label}
                    <span className="text-xs text-muted">{SCHEMA_LABEL[sc].detail}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Start" hint={`Earliest ${s.historyStart}`}>
                <Input type="date" className="num" min={s.historyStart} value={start} onChange={(e) => {
                    setStart(e.target.value)
                    resetEstimate()
                  }} required />
              </Field>
              <Field label="End (exclusive)" hint="Blank = latest available" error={end && end <= start ? 'End must be after start' : undefined}>
                <Input type="date" className="num" value={end} onChange={(e) => {
                    setEnd(e.target.value)
                    resetEstimate()
                  }} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
              <Button type="submit" variant="secondary" disabled={invalid || estimate.isPending}>
                {estimate.isPending ? 'Estimating…' : 'Estimate cost (free)'}
              </Button>
              {estimate.isPending && <span className="text-xs text-muted">Long ranges take up to a minute on Databento’s side.</span>}
            </div>
          </form>

          {estimate.error && <div className="mt-3"><ErrorNote error={new Error(errorMessage(estimate.error))} /></div>}
          {estimate.data && isNotConfigured(estimate.data) && <NotConfiguredState info={estimate.data} />}

          {est && (
            <div className="mt-4 space-y-3 border-t border-border pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-xs text-muted">
                  <span className="num">{fmtDate(est.start)}</span> → <span className="num">{fmtDate(est.end)}</span> (exclusive)
                </div>
                {est.withinBudget ? <Chip tone="strong">Within budget</Chip> : <Chip tone="moderate">Over budget · needs override</Chip>}
              </div>
              <DataTable
                dense
                columns={costColumns}
                rows={est.lines}
                rowKey={(l) => `${l.root}|${l.schema}`}
                caption="Cost estimate by root and schema"
                footer={
                  <tr>
                    <td colSpan={3} className="label px-2 py-1.5">
                      Total
                    </td>
                    <td className="num px-2 py-1.5 text-right font-medium text-foreground">{usd(est.total)}</td>
                  </tr>
                }
              />

              {!confirming ? (
                <Button variant="primary" disabled={running} onClick={() => setConfirming(true)}>
                  Run backfill…
                </Button>
              ) : (
                <div role="group" aria-label="Confirm paid backfill" className="space-y-3 rounded-md border border-border-strong bg-surface-2/60 p-3">
                  <p className="text-sm text-foreground">
                    This downloads {est.lines.length} series from Databento and spends about <strong className="num">{usd(est.total)}</strong> of credit.
                    The pull stops if its running cost would pass <strong className="num">{usd(cap)}</strong>.
                    {!est.withinBudget && <> That is above the configured budget of <span className="num">{fmtUsd(est.budget)}</span>.</>}
                  </p>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5 size-3.5 accent-brand" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                    <span>
                      I authorise spending up to <span className="num">{usd(cap)}</span> on this backfill.
                    </span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      disabled={!acknowledged || backfill.isPending || running}
                      onClick={() =>
                        backfill.mutate(
                          { roots, schemas, start: est.start, end: est.end, maxCost: cap },
                          {
                            onSuccess: (o) => {
                              setOutcome(o)
                              setConfirming(false)
                              setAcknowledged(false)
                            },
                          },
                        )
                      }
                    >
                      {backfill.isPending ? 'Starting…' : `Confirm backfill · ${usd(est.total)}`}
                    </Button>
                    <Button variant="ghost" onClick={() => {
                        setConfirming(false)
                        setAcknowledged(false)
                      }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {backfill.error && <ErrorNote error={new Error(errorMessage(backfill.error))} />}
              {outcome?.kind === 'over_budget' && <ErrorNote error={new Error(outcome.body.message)} />}
              {outcome?.kind === 'not_configured' && <NotConfiguredState info={outcome.info} />}
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Open interest" eyebrow="statistics schema" density="dense" provenance={{ source: 'contract_bars (databento)', note: 'collected going forward' }}>
            <OpenInterestNote rows={s.openInterest} />
          </Panel>
          <Panel title="Backfill job" density="dense">
            {s.backfill && s.backfill.state !== 'idle' ? (
              <JobProgress job={s.backfill} label="Databento backfill" />
            ) : (
              <p className="text-xs text-muted">No backfill has run since the server started. Recorded runs are listed under Jobs & schedule.</p>
            )}
          </Panel>
          <Explainer title="How the cost guard works">
            <p>
              Every paid download is preceded by Databento’s free <code className="num">metadata.get_cost</code> call. A pull over{' '}
              <span className="num">{fmtUsd(s.budget)}</span> (DATABENTO_BUDGET) is refused unless you confirm an explicit cap here; each monthly
              chunk is re-estimated and the job stops before the running total would pass that cap.
            </p>
            <p>
              Only outright contracts are stored (calendar-spread instruments are dropped). Single-digit CME symbols such as{' '}
              <code className="num">GCZ6</code> are mapped to <code className="num">GCZ26</code> using the record date. Reference full-history cost
              (2010 → today): GC bars ≈ $1.55, GC open interest ≈ $0.99, SI bars ≈ $1.13, MGC bars ≈ $0.54.
            </p>
            <p>
              The daily incremental job resumes from the last stored date for bars and open interest of every root, and is capped at $1 in total (or the
              budget, if lower). Open interest was never backfilled; it accrues from the first incremental run onward.
            </p>
          </Explainer>
        </div>
      </div>
    </div>
  )
}
