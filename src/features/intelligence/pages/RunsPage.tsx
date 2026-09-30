import type { MlRunSummary } from '@shared/ml'
import { UNIVERSE } from '@shared/universe'
import { fmtDate, fmtDateTime, fmtNum } from '../../../design/format'
import { useSettings } from '../../../store/settings-context'
import { Chip, DataTable, ErrorNote, Panel, PanelSkeleton, type Column } from '../../../ui'
import { useMlRuns, useMlStatus } from '../api'
import { JobControls } from '../components/JobControls'
import { ValidationChip } from '../components/common'

function duration(r: MlRunSummary): string {
  if (!r.finishedAt) return '—'
  const s = (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000
  return s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`
}

export default function RunsPage() {
  const { metal } = useSettings()
  const runs = useMlRuns(metal)
  const status = useMlStatus()
  const py = status.data?.python

  const columns: Column<MlRunSummary>[] = [
    { key: 'id', header: 'Run', sortValue: (r) => r.id, cell: (r) => <span className="num">#{r.id}</span> },
    { key: 'start', header: 'Started', sortValue: (r) => r.startedAt, cell: (r) => <span className="num">{fmtDateTime(r.startedAt)}</span> },
    { key: 'dur', header: 'Duration', numeric: true, cell: duration },
    {
      key: 'state', header: 'Job',
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <Chip tone={r.status === 'succeeded' ? 'neutral' : r.status === 'running' ? 'brand' : 'avoid'}>{r.status}</Chip>
          {r.error && <span className="max-w-xs truncate text-2xs text-neg-text" title={r.error}>{r.error}</span>}
        </div>
      ),
    },
    { key: 'val', header: 'Validation', cell: (r) => (r.status === 'succeeded' ? <ValidationChip status={r.validationStatus} /> : '—') },
    { key: 'auc', header: 'Mean AUC', numeric: true, sortValue: (r) => r.auc, cell: (r) => fmtNum(r.auc, 3) },
    { key: 'p', header: 'Perm. p', numeric: true, cell: (r) => fmtNum(r.pValue, 3) },
    { key: 'folds', header: 'Test years', numeric: true, cell: (r) => r.folds ?? '—' },
    { key: 'thru', header: 'Data through', numeric: true, cell: (r) => fmtDate(r.dataThrough) },
  ]

  return (
    <div className="space-y-6">
      <Panel title="Run a job" density="dense">
        <JobControls metal={metal} />
      </Panel>
      <Panel
        title={`${UNIVERSE[metal].label} training runs`}
        provenance={{
          source: py
            ? py.available
              ? `Python ${py.pythonVersion} · scikit-learn ${py.sklearnVersion} · ${py.interpreter}`
              : `Python unavailable: ${py.error}`
            : 'Checking Python…',
        }}
      >
        {runs.isLoading ? (
          <PanelSkeleton rows={5} />
        ) : runs.error ? (
          <ErrorNote error={runs.error} onRetry={() => runs.refetch()} />
        ) : (
          <DataTable dense columns={columns} rows={runs.data ?? []} rowKey={(r) => String(r.id)}
            initialSort={{ key: 'id', dir: 'desc' }} empty="No runs yet. Train a model to start." />
        )}
      </Panel>
    </div>
  )
}
