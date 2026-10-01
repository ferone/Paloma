import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { ScheduleStatus } from '@shared/marketdata'
import { fmtAge, fmtDateTime } from '../../design/format'
import { Button, Chip, ErrorNote, Field, Input, Panel, PanelSkeleton } from '../../ui'
import { errorMessage, useSaveSchedule, useSchedule } from '../data/api'

type LastRun = NonNullable<ScheduleStatus['lastRun']>

/** One-line verdict on the last scheduled run. */
function lastRunSummary(run: LastRun): { label: string; tone: 'strong' | 'avoid' | 'neutral' | 'brand' } {
  if (!run.finishedAt) return { label: 'In progress', tone: 'brand' }
  const failed = run.results.filter((r) => r.outcome === 'failed' || r.outcome.startsWith('error') || r.outcome.startsWith('timeout')).length
  if (failed) return { label: `${failed} of ${run.results.length} failed`, tone: 'avoid' }
  return { label: `${run.results.length} jobs ok`, tone: 'strong' }
}

/**
 * Settings → daily refresh: the essentials of the scheduler (on/off, time,
 * next and last run). The job list and per-job outcomes live in Data Center → Jobs.
 */
export function SchedulerPanel() {
  const schedule = useSchedule()
  return (
    <Panel title="Daily refresh" eyebrow="Scheduler">
      {schedule.isLoading ? (
        <PanelSkeleton rows={3} />
      ) : schedule.error ? (
        <ErrorNote error={schedule.error} onRetry={() => schedule.refetch()} />
      ) : (
        <SchedulerForm key={`${schedule.data!.enabled}|${schedule.data!.timeUtc}`} s={schedule.data!} />
      )}
    </Panel>
  )
}

function SchedulerForm({ s }: { s: ScheduleStatus }) {
  const save = useSaveSchedule()
  const [enabled, setEnabled] = useState(s.enabled)
  const [timeUtc, setTimeUtc] = useState(s.timeUtc)
  const dirty = enabled !== s.enabled || timeUtc !== s.timeUtc
  const last = s.lastRun
  const verdict = last ? lastRunSummary(last) : null

  function submit(e: FormEvent) {
    e.preventDefault()
    if (dirty) save.mutate({ enabled, timeUtc, skipWeekends: s.skipWeekends, jobs: s.jobs })
  }

  return (
    <form onSubmit={submit}>
      <p className="mb-4 text-sm leading-relaxed text-muted">
        After the CME close it refreshes prices, macro and COT, Databento (within the spend guard), the Quant Lab, ML scores and the NAV, in that order.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
          <input type="checkbox" className="size-3.5 accent-brand" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Run every weekday
        </label>
        <Field label="Time (UTC)" className="w-32">
          <Input type="time" className="num" value={timeUtc} onChange={(e) => setTimeUtc(e.target.value)} required disabled={!enabled} />
        </Field>
        <Button type="submit" size="sm" variant="primary" disabled={!dirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        {save.isSuccess && !dirty && <span className="text-xs text-pos-text">Saved</span>}
      </div>
      {save.error && <ErrorNote error={new Error(errorMessage(save.error))} />}

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Status</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {s.running ? <Chip tone="brand">Running</Chip> : s.enabled ? <Chip tone="strong">On</Chip> : <Chip tone="neutral">Off</Chip>}
          {s.isDefault && <span className="text-xs text-muted">default; not yet saved</span>}
        </dd>
        <dt className="text-muted">Next run</dt>
        <dd className="num text-foreground">{s.nextRunAt ? fmtDateTime(s.nextRunAt) : '—'}</dd>
        <dt className="text-muted">Last run</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {last && verdict ? (
            <>
              <span className="num text-foreground">{last.finishedAt ? fmtAge(last.finishedAt) : fmtAge(last.startedAt)}</span>
              <Chip tone={verdict.tone}>{verdict.label}</Chip>
            </>
          ) : (
            <span className="text-muted">Never</span>
          )}
        </dd>
      </dl>
      <Link to="/data/jobs" className="mt-4 inline-block text-sm text-brand underline underline-offset-2">
        Jobs, order and run history in Data Center
      </Link>
    </form>
  )
}
