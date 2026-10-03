import { UNIVERSE, type AssetId } from '@shared/universe'
import { fmtAge, fmtPct } from '../../../design/format'
import { Button, ErrorNote } from '../../../ui'
import { useMlJobs, useMlStatus, useStartMlJob } from '../api'

/** "Train now" / "Run inference" with live job progress (polls /api/jobs). */
export function JobControls({ metal }: { metal?: AssetId }) {
  const jobs = useMlJobs()
  const status = useMlStatus()
  const start = useStartMlJob()
  const running = jobs.data?.find((j) => j.state === 'running')
  const recent = jobs.data
    ?.filter((j) => j.finishedAt)
    .sort((a, b) => (a.finishedAt! < b.finishedAt! ? 1 : -1))[0]
  const noPython = status.data && !status.data.python.available

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={!!running || !!noPython || start.isPending}
          onClick={() => start.mutate({ kind: 'train', metal })}>
          {metal ? `Train ${UNIVERSE[metal].label.toLowerCase()} now` : 'Train now'}
        </Button>
        <Button size="sm" disabled={!!running || !!noPython || start.isPending} onClick={() => start.mutate({ kind: 'infer' })}>
          Run inference
        </Button>
        <span className="text-2xs text-muted">
          Training runs the full walk-forward and permutation test (several minutes per asset). Inference reuses the saved model and retrains it
          if it is older than {status.data?.maxModelAgeDays ?? 7} days.
        </span>
      </div>
      {noPython && <ErrorNote error={new Error(status.data!.python.error ?? 'Python unavailable')} />}
      {start.error && <ErrorNote error={start.error} />}
      {running ? (
        <div role="status" aria-live="polite" className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-foreground">{running.name === 'ml.train' ? 'Training' : 'Inference'} · {running.message ?? 'starting'}</span>
            <span className="num text-muted">{fmtPct(running.progress ?? 0, 0)}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-brand transition-[width] duration-500" style={{ width: `${(running.progress ?? 0) * 100}%` }} />
          </div>
        </div>
      ) : (
        recent && (
          <p className="text-2xs text-muted">
            Last job: <span className="num">{recent.name}</span> {recent.state} {fmtAge(recent.finishedAt)}
            {recent.message ? ` — ${recent.message}` : ''}
          </p>
        )
      )}
    </div>
  )
}
