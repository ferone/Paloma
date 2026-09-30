import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { JobRunRow, ScheduleConfig, ScheduleStatus } from '@shared/marketdata'
import { fmtAge, fmtDateTime } from '../../../design/format'
import { Button, Chip, DataTable, ErrorNote, Field, Input, Panel, PanelSkeleton, type Column } from '../../../ui'
import { JobProgress, JobStateChip } from '../JobProgress'
import {
  errorMessage,
  useIntegrationStatus,
  useJobRuns,
  useJobs,
  useRunJob,
  useRunScheduleNow,
  useSaveSchedule,
  useSchedule,
  type RegisteredJob,
} from '../api'

/** Jobs that need parameters or a paid confirmation are started from their own screen. */
const LAUNCHED_ELSEWHERE: Record<string, { to: string; label: string }> = {
  'marketdata.databento.backfill': { to: '/data/databento', label: 'Configure on Databento tab' },
}

function JobsTable() {
  const jobs = useJobs()
  const status = useIntegrationStatus()
  const run = useRunJob()
  const [lastError, setLastError] = useState<string | null>(null)

  if (jobs.isLoading) return <PanelSkeleton rows={4} />
  if (jobs.error) return <ErrorNote error={jobs.error} onRetry={() => jobs.refetch()} />

  const needsDatabento = (name: string) => name.startsWith('marketdata.databento') && status.data && !status.data.databento

  const columns: Column<RegisteredJob>[] = [
    {
      key: 'name',
      header: 'Job',
      sortValue: (j) => j.name,
      cell: (j) => (
        <div className="min-w-0">
          <div className="num text-xs font-medium text-foreground">{j.name}</div>
          <div className="text-2xs text-muted">{j.description}</div>
        </div>
      ),
    },
    {
      key: 'state',
      header: 'State',
      sortValue: (j) => j.state,
      cell: (j) => (j.state === 'idle' ? <JobStateChip state="idle" /> : <div className="min-w-48 max-w-md"><JobProgress job={j} label={j.startedAt ? `started ${fmtAge(j.startedAt)}` : ''} /></div>),
    },
    {
      key: 'action',
      header: <span className="sr-only">Action</span>,
      className: 'text-right',
      cell: (j) => {
        const elsewhere = LAUNCHED_ELSEWHERE[j.name]
        if (elsewhere)
          return (
            <Link to={elsewhere.to} className="whitespace-nowrap text-xs text-brand underline underline-offset-2">
              {elsewhere.label}
            </Link>
          )
        if (needsDatabento(j.name)) return <Chip tone="neutral" title="Set DATABENTO_API_KEY in .env">Not configured</Chip>
        return (
          <Button
            size="sm"
            disabled={j.state === 'running' || (run.isPending && run.variables === j.name)}
            onClick={() => {
              setLastError(null)
              run.mutate(j.name, { onError: (e) => setLastError(errorMessage(e)) })
            }}
            aria-label={`Run ${j.name}`}
          >
            {j.state === 'running' ? 'Running…' : 'Run now'}
          </Button>
        )
      },
    },
  ]

  return (
    <>
      {lastError && <div className="mb-2"><ErrorNote error={new Error(lastError)} /></div>}
      <DataTable dense columns={columns} rows={jobs.data!} rowKey={(j) => j.name} caption="Registered background jobs" empty="No jobs registered." />
    </>
  )
}

const runColumns: Column<JobRunRow>[] = [
  { key: 'id', header: '#', numeric: true, cell: (r) => r.id },
  { key: 'name', header: 'Job', cell: (r) => <span className="num text-xs">{r.name}</span> },
  { key: 'state', header: 'Result', cell: (r) => <JobStateChip state={r.state} /> },
  { key: 'started', header: 'Started', cell: (r) => <span className="num whitespace-nowrap text-xs">{fmtDateTime(r.startedAt)}</span> },
  {
    key: 'dur',
    header: 'Duration',
    numeric: true,
    cell: (r) => {
      if (!r.finishedAt) return '—'
      const s = Math.max(0, (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000)
      return s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`
    },
  },
  { key: 'msg', header: 'Message', cell: (r) => <span className={`text-2xs ${r.state === 'failed' ? 'text-neg-text' : 'text-muted'}`}>{r.message ?? '—'}</span> },
]

function ScheduleForm({ status, registered }: { status: ScheduleStatus; registered: string[] }) {
  const save = useSaveSchedule()
  const runNow = useRunScheduleNow()
  const [cfg, setCfg] = useState<ScheduleConfig>({ enabled: status.enabled, timeUtc: status.timeUtc, skipWeekends: status.skipWeekends, jobs: status.jobs })
  const [extra, setExtra] = useState('')
  const known = [...new Set([...cfg.jobs, ...registered])]
  const dirty = JSON.stringify(cfg) !== JSON.stringify({ enabled: status.enabled, timeUtc: status.timeUtc, skipWeekends: status.skipWeekends, jobs: status.jobs })

  const toggleJob = (name: string) => setCfg((c) => ({ ...c, jobs: c.jobs.includes(name) ? c.jobs.filter((j) => j !== name) : [...c.jobs, name] }))
  const addExtra = () => {
    const n = extra.trim()
    if (/^[\w.:-]+$/.test(n) && !cfg.jobs.includes(n)) setCfg((c) => ({ ...c, jobs: [...c.jobs, n] }))
    setExtra('')
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(cfg)
      }}
    >
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" className="size-3.5 accent-brand" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
        Run the daily schedule
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Time (UTC)" hint="After the CME close; 22:30 UTC is 18:30 New York in summer">
          <Input type="time" className="num" value={cfg.timeUtc} onChange={(e) => setCfg({ ...cfg, timeUtc: e.target.value })} required />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" className="size-3.5 accent-brand" checked={cfg.skipWeekends} onChange={(e) => setCfg({ ...cfg, skipWeekends: e.target.checked })} />
          Skip Saturdays and Sundays
        </label>
      </div>
      <fieldset>
        <legend className="label mb-1.5">Jobs, run in this order</legend>
        <ul className="space-y-1">
          {known.map((name) => {
            const unregistered = !registered.includes(name)
            const order = cfg.jobs.indexOf(name)
            return (
              <li key={name}>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="size-3.5 accent-brand" checked={order >= 0} onChange={() => toggleJob(name)} />
                  <span className="num w-5 text-right text-2xs text-faint">{order >= 0 ? order + 1 : ''}</span>
                  <span className="num text-xs">{name}</span>
                  {unregistered && (
                    <Chip tone="neutral" title="No domain has registered this job yet; the scheduler skips it until one does">
                      Not registered
                    </Chip>
                  )}
                </label>
              </li>
            )
          })}
        </ul>
        <div className="mt-2 flex gap-2">
          <Input
            aria-label="Add a job by name"
            placeholder="Add job by name, e.g. macro.cot"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addExtra()
              }
            }}
            className="num max-w-xs"
          />
          <Button size="sm" onClick={addExtra} disabled={!extra.trim()}>
            Add
          </Button>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button type="submit" variant="primary" disabled={!dirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save schedule'}
        </Button>
        <Button onClick={() => runNow.mutate()} disabled={status.running || runNow.isPending || dirty} title={dirty ? 'Save first' : undefined}>
          Run list now
        </Button>
        {save.isSuccess && !dirty && <span className="text-xs text-muted">Saved.</span>}
      </div>
      {save.error && <ErrorNote error={new Error(errorMessage(save.error))} />}
      {runNow.error && <ErrorNote error={new Error(errorMessage(runNow.error))} />}
    </form>
  )
}

function SchedulePanel() {
  const schedule = useSchedule()
  const jobs = useJobs()
  if (schedule.isLoading || jobs.isLoading) return <PanelSkeleton rows={6} />
  if (schedule.error) return <ErrorNote error={schedule.error} onRetry={() => schedule.refetch()} />
  const s = schedule.data!
  const last = s.lastRun
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="label">Status</dt>
          <dd className="mt-1">{s.running ? <Chip tone="brand">Running</Chip> : s.enabled ? <Chip tone="strong">Enabled</Chip> : <Chip tone="neutral">Off</Chip>}</dd>
        </div>
        <div>
          <dt className="label">Next run</dt>
          <dd className="num mt-1 text-foreground">{s.nextRunAt ? fmtDateTime(s.nextRunAt) : '—'}</dd>
        </div>
      </dl>
      <ScheduleForm key={JSON.stringify([s.enabled, s.timeUtc, s.skipWeekends, s.jobs])} status={s} registered={(jobs.data ?? []).map((j) => j.name)} />
      {last && (
        <div className="border-t border-border pt-3">
          <div className="label mb-1.5">
            Last run · {last.date} · {last.finishedAt ? `finished ${fmtAge(last.finishedAt)}` : 'in progress'}
          </div>
          <ul className="space-y-0.5 text-xs">
            {last.results.map((r) => (
              <li key={r.job} className="flex justify-between gap-3">
                <span className="num">{r.job}</span>
                <span className={r.outcome === 'succeeded' ? 'text-pos-text' : r.outcome === 'failed' || r.outcome.startsWith('error') ? 'text-neg-text' : 'text-muted'}>{r.outcome}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function JobsPage() {
  const runs = useJobRuns(40)
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-4">
        <Panel title="Registered jobs" eyebrow="All domains" density="dense" provenance={{ source: 'In-process job registry', note: 'one run per job at a time' }}>
          <JobsTable />
        </Panel>
        <Panel title="Recent runs" density="dense" provenance={{ source: 'job_runs table', note: 'latest 40' }}>
          {runs.isLoading ? (
            <PanelSkeleton rows={5} />
          ) : runs.error ? (
            <ErrorNote error={runs.error} onRetry={() => runs.refetch()} />
          ) : (
            <DataTable dense columns={runColumns} rows={runs.data!} rowKey={(r) => String(r.id)} caption="Recent job runs" empty="No job has run yet." />
          )}
        </Panel>
      </div>
      <Panel title="Daily schedule" eyebrow="Opt-in" density="dense" provenance={{ source: 'settings: scheduler', note: 'jobs run sequentially; unknown names are skipped' }}>
        <SchedulePanel />
      </Panel>
    </div>
  )
}
