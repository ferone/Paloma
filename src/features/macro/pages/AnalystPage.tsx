import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ReportKind, ReportRequest } from '@shared/ai'
import { UNIVERSE } from '@shared/universe'
import { useSettings } from '../../../store/settings-context'
import { Button, EmptyState, ErrorNote, Field, NotConfiguredState, Panel, PanelSkeleton, Textarea, isNotConfigured } from '../../../ui'
import { fmtDateTime } from '../../../design/format'
import { errorMessage, useAiStatus, useDeleteReport, useGenerateReport, useReport, useReports } from '../api'
import { ModelPicker } from '../ai/ModelPicker'
import { ReportReader } from '../ai/ReportReader'
import { ReportHistory } from '../ai/ReportHistory'
import { KIND_LABEL } from '../ai/labels'

const KIND_HELP: Record<Exclude<ReportKind, 'ask'>, string> = {
  macro_brief: 'Drivers, risks and what would change the view, from the live scorecard and COT.',
  trade_brief: 'Thesis, legs, entry plan and invalidation for the top-ranked Quant Lab opportunity.',
  portfolio_commentary: 'Investor-grade paragraph and bullets for the factsheet, from the latest NAV.',
}

export default function AnalystPage() {
  const { asset: metal } = useSettings()
  const [params] = useSearchParams()
  const status = useAiStatus()
  const reports = useReports(metal)
  const generate = useGenerateReport()
  const del = useDeleteReport()
  // The selection remembers which asset it belongs to, so switching asset shows that asset's latest report.
  const [picked, setPicked] = useState<{ asset: typeof metal; id: number } | null>(null)
  const selected = picked?.asset === metal ? picked.id : null
  const setSelected = (id: number | null) => setPicked(id == null ? null : { asset: metal, id })
  const [question, setQuestion] = useState('')
  // Newest first from the API: the latest report is shown unless an older one is picked.
  const latestId = reports.data?.[0]?.id ?? null
  const activeId = selected ?? latestId
  const active = useReport(activeId)

  const run = (req: ReportRequest) =>
    generate.mutate(req, {
      onSuccess: (r) => {
        if (!isNotConfigured(r)) setSelected(r.id)
      },
    })
  const opportunityId = params.get('opportunity') ?? undefined
  const notConfigured = status.data && !status.data.configured

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Panel title="Generate" eyebrow={`AI analyst · ${UNIVERSE[metal].label}`} density="dense">
          {notConfigured ? (
            <NotConfiguredState
              info={{
                status: 'not_configured',
                missing: ['OPENROUTER_API_KEY'],
                message: 'The AI analyst needs an OpenRouter API key. Macro data, positioning and correlations work without it.',
              }}
            />
          ) : (
            <div className="space-y-2">
              {(Object.keys(KIND_HELP) as (keyof typeof KIND_HELP)[]).map((k) => (
                <div key={k} className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{KIND_LABEL[k]}</div>
                    <p className="text-2xs leading-relaxed text-muted">
                      {KIND_HELP[k]}
                      {k === 'trade_brief' && opportunityId && (
                        <>
                          {' '}
                          Linked opportunity: <code className="num text-foreground">{opportunityId}</code>.
                        </>
                      )}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={generate.isPending || !status.data}
                    onClick={() => run({ kind: k, metal, input: k === 'trade_brief' && opportunityId ? { opportunityId } : undefined })}
                  >
                    Generate
                  </Button>
                </div>
              ))}
              <form
                className="pt-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (question.trim().length >= 3) run({ kind: 'ask', metal, input: { question: question.trim() } })
                }}
              >
                <Field label="Ask the analyst" hint="Answered with the live macro, COT, quant and portfolio context.">
                  <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={`e.g. How exposed is ${UNIVERSE[metal].label.toLowerCase()} to a risk-off shock right now?`} maxLength={2000} />
                </Field>
                <Button type="submit" size="sm" variant="primary" className="mt-2" disabled={generate.isPending || question.trim().length < 3}>
                  Ask
                </Button>
              </form>
              {generate.error && <p role="alert" className="text-xs text-neg-text">{errorMessage(generate.error)}</p>}
            </div>
          )}
        </Panel>

        <details className="group rounded-lg border border-border bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[13px] font-medium text-foreground">
            Model & web sourcing
            <span className="num text-2xs font-normal text-muted">{status.data?.effectiveModel}</span>
          </summary>
          <div className="border-t border-border p-3">
            <ModelPicker compact />
          </div>
        </details>

        <Panel title={`${UNIVERSE[metal].label} reports`} eyebrow="History · saved per asset" density="dense">
          {reports.isLoading ? (
            <PanelSkeleton rows={4} />
          ) : reports.error ? (
            <ErrorNote error={reports.error} onRetry={() => reports.refetch()} />
          ) : !reports.data?.length ? (
            <EmptyState compact title={`No ${UNIVERSE[metal].label.toLowerCase()} reports yet`}>
              Briefs and answers generated while {UNIVERSE[metal].label} is in focus are kept here with their sources and cost. Switch asset in the top bar to see
              another asset&rsquo;s reports.
            </EmptyState>
          ) : (
            <ReportHistory reports={reports.data} activeId={activeId} latestId={latestId} onSelect={setSelected} />
          )}
        </Panel>
      </div>

      <Panel className="min-w-0" bodyClassName="px-1 py-2 md:px-6">
        {activeId == null ? (
          <EmptyState title={`Nothing to read yet for ${UNIVERSE[metal].label}`}>
            Generate a {UNIVERSE[metal].label.toLowerCase()} macro brief or ask a question. Reports cite real, fetched pages or are flagged as unsourced.
          </EmptyState>
        ) : active.isLoading ? (
          <PanelSkeleton rows={10} />
        ) : active.error ? (
          <ErrorNote error={active.error} onRetry={() => active.refetch()} />
        ) : active.data ? (
          <>
          {latestId != null && activeId !== latestId && (
            <p className="mx-1 mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2/60 px-3 py-2 text-xs text-muted md:mx-0">
              Viewing an older report from {fmtDateTime(active.data.createdAt)}.
              <button type="button" className="text-brand underline underline-offset-2" onClick={() => setSelected(null)}>
                Back to the latest
              </button>
            </p>
          )}
          <ReportReader
            report={active.data}
            busy={generate.isPending || del.isPending || !!notConfigured}
            onRegenerate={notConfigured ? undefined : () => run(active.data!.request)}
            onDelete={() => {
              if (window.confirm('Delete this report?')) del.mutate(active.data!.id, { onSuccess: () => setSelected(null) })
            }}
          />
          </>
        ) : null}
      </Panel>
    </div>
  )
}
