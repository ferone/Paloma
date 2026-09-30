import type { JobStatus } from '@shared/api'
import { fmtAge, fmtPct } from '../../design/format'
import { Chip, type ChipTone } from '../../ui'

const STATE_TONE: Record<JobStatus['state'], ChipTone> = {
  idle: 'neutral',
  running: 'brand',
  succeeded: 'strong',
  failed: 'avoid',
}

export function JobStateChip({ state }: { state: JobStatus['state'] }) {
  return <Chip tone={STATE_TONE[state]}>{state}</Chip>
}

/** Progress bar + status line for a running or finished job. */
export function JobProgress({ job, label }: { job: JobStatus; label?: string }) {
  const pct = job.progress ?? (job.state === 'succeeded' ? 1 : 0)
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <JobStateChip state={job.state} />
        <span className="text-muted">{label ?? job.name}</span>
        {job.state === 'running' && <span className="num text-foreground">{fmtPct(pct, 0)}</span>}
        {job.finishedAt && <span className="text-faint">finished {fmtAge(job.finishedAt)}</span>}
      </div>
      {job.state === 'running' && (
        <div
          role="progressbar"
          aria-label={`${label ?? job.name} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct * 100)}
          className="h-1 overflow-hidden rounded-full bg-surface-2"
        >
          <div className="h-full bg-brand transition-[width]" style={{ width: `${Math.max(2, pct * 100)}%` }} />
        </div>
      )}
      {job.message && <p className={`break-words text-2xs ${job.state === 'failed' ? 'text-neg-text' : 'text-muted'}`}>{job.message}</p>}
    </div>
  )
}
