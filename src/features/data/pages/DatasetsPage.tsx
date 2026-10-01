import { Link } from 'react-router-dom'
import type { FreshnessRow } from '@shared/marketdata'
import { fmtAge, fmtDate, fmtNum } from '../../../design/format'
import { Chip, DataTable, EmptyState, ErrorNote, Explainer, Panel, PanelSkeleton, Stat, type Column } from '../../../ui'
import { useFreshness } from '../api'
import { DATASET_LABEL, datasetLabel, sourceLabel } from '../labels'
import { OpenInterestNote } from '../OpenInterestNote'

function StatusChip({ row }: { row: FreshnessRow }) {
  if (!row.rows) return <Chip tone="neutral">Empty</Chip>
  if (row.maxAgeDays == null) return <Chip tone="neutral">Reference</Chip>
  return row.stale ? (
    <Chip tone="avoid" title={`Latest data is ${row.ageDays} days old; tolerance is ${row.maxAgeDays} days`}>
      Stale
    </Chip>
  ) : (
    <Chip tone="strong">Fresh</Chip>
  )
}

const columns: Column<FreshnessRow>[] = [
  {
    key: 'dataset',
    header: 'Dataset',
    sortValue: (r) => r.dataset,
    cell: (r) => (
      <div className="min-w-0">
        <div className="font-medium text-foreground">{datasetLabel(r.dataset)}</div>
        <div className="num text-2xs text-faint">{r.dataset}</div>
      </div>
    ),
  },
  { key: 'source', header: 'Source', sortValue: (r) => r.source, cell: (r) => <span className="text-muted">{sourceLabel(r.source)}</span> },
  { key: 'symbols', header: 'Symbols', numeric: true, sortValue: (r) => r.symbols, cell: (r) => (r.symbols ? fmtNum(r.symbols, 0) : '—') },
  { key: 'rows', header: 'Rows', numeric: true, sortValue: (r) => r.rows, cell: (r) => fmtNum(r.rows, 0) },
  {
    key: 'range',
    header: 'Coverage',
    sortValue: (r) => r.from,
    cell: (r) =>
      r.from ? (
        <span className="num whitespace-nowrap text-xs">
          {fmtDate(r.from)} <span className="text-faint">→</span> {fmtDate(r.to)}
        </span>
      ) : (
        <span className="text-faint">—</span>
      ),
  },
  {
    key: 'age',
    header: 'Data age',
    numeric: true,
    sortValue: (r) => r.ageDays,
    cell: (r) => (r.ageDays == null ? '—' : r.ageDays === 0 ? 'today' : `${r.ageDays} d`),
  },
  {
    key: 'job',
    header: 'Last refresh',
    sortValue: (r) => r.lastJob?.finishedAt ?? null,
    cell: (r) =>
      r.lastJob ? (
        <div className="whitespace-nowrap">
          <div className="text-xs text-foreground">{fmtAge(r.lastJob.finishedAt)}</div>
          <div className="num text-2xs text-faint">{r.lastJob.name}</div>
        </div>
      ) : (
        <span className="text-xs text-faint">never</span>
      ),
  },
  { key: 'status', header: 'Status', sortValue: (r) => (r.stale ? 1 : 0), cell: (r) => <StatusChip row={r} /> },
]

export default function DatasetsPage() {
  const q = useFreshness()

  if (q.isLoading) return <Panel><PanelSkeleton rows={8} /></Panel>
  if (q.error) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  const all = q.data!.rows
  const present = all.filter((r) => r.exists && (r.rows > 0 || r.dataset in DATASET_LABEL))
  const absent = all.filter((r) => !r.exists)
  const withData = present.filter((r) => r.rows > 0)
  const stale = withData.filter((r) => r.stale)
  const totalRows = withData.reduce((s, r) => s + r.rows, 0)
  const latest = withData.filter((r) => r.maxAgeDays != null && r.to).map((r) => r.to!).sort().at(-1) ?? null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-4">
        <Stat label="Datasets with data" value={fmtNum(withData.length, 0)} hint={`${present.length} tracked`} size="sm" />
        <Stat label="Rows stored" value={fmtNum(totalRows, 0)} size="sm" />
        <Stat
          label="Stale"
          value={<span className={stale.length ? 'text-neg-text' : undefined}>{fmtNum(stale.length, 0)}</span>}
          hint={stale.length ? stale.map((r) => `${datasetLabel(r.dataset)} (${sourceLabel(r.source)})`).join(', ') : 'All within tolerance'}
          size="sm"
        />
        <Stat label="Latest market data" value={<span className="text-base">{fmtDate(latest)}</span>} size="sm" />
      </div>

      <Panel
        title="Freshness by dataset and source"
        density="dense"
        provenance={{ source: 'Local SQLite store', asOf: latest, note: `checked ${fmtAge(q.data!.generatedAt)}` }}
      >
        {withData.length === 0 ? (
          <EmptyState
            title="No market data stored yet"
            action={
              <Link className="text-sm text-brand underline underline-offset-2" to="/data/jobs">
                Run the Yahoo refresh
              </Link>
            }
          >
            Yahoo history is free and fills daily prices in under a minute. Databento contract history is a paid, cost-guarded backfill.
          </EmptyState>
        ) : (
          <DataTable dense columns={columns} rows={present} rowKey={(r) => `${r.dataset}|${r.source}`} caption="Dataset freshness" />
        )}
        {absent.length > 0 && (
          <p className="mt-3 text-2xs text-muted">
            Not created yet by their domains: {absent.map((r) => datasetLabel(r.dataset)).join(', ')}.
          </p>
        )}
        {withData.some((r) => r.dataset === 'contract_bars' && r.source === 'databento') && (
          <OpenInterestNote rows={q.data!.openInterest} className="mt-3 border-t border-border pt-3" />
        )}
      </Panel>

      <Explainer>
        <p>
          <strong className="text-foreground">Data age</strong> is days between the latest stored observation and today. Daily market data is
          stale after 4 days (a weekend plus a holiday), macro series after 7, CFTC reports after 10.
        </p>
        <p>
          <strong className="text-foreground">Last refresh</strong> is the most recent successful job that writes the dataset. A fresh job with
          old data means the source itself has not published anything newer.
        </p>
        <p>
          Contract bars prefer Databento; Yahoo only fills contract-days Databento has not covered, and never overwrites a Databento row.
        </p>
      </Explainer>
    </div>
  )
}
