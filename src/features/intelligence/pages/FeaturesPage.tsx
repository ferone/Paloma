import { FEATURES, type FeatureAvailability, type FeatureSpec } from '@shared/ml'
import { fmtDate, fmtPct } from '../../../design/format'
import { Chip, DataTable, Explainer, Panel, type Column } from '../../../ui'
import { ImportanceBars } from '../components/charts'
import { runProvenance } from '../components/provenance'
import { RunScope } from '../components/RunScope'

type Row = FeatureSpec & { avail: FeatureAvailability | undefined; importance: number | null }

export default function FeaturesPage() {
  return (
    <RunScope>
      {(run) => {
        const imp = new Map(run.importance.map((i) => [i.feature, i.mean]))
        const rows: Row[] = FEATURES.map((f) => ({
          ...f,
          avail: run.availability.find((a) => a.id === f.id),
          importance: imp.get(f.id) ?? null,
        }))
        const unused = rows.filter((r) => !r.avail?.used)
        const columns: Column<Row>[] = [
          {
            key: 'label', header: 'Feature', sortValue: (r) => r.label,
            cell: (r) => (
              <div>
                <div className="text-foreground">{r.label}</div>
                <div className="num text-2xs text-muted">{r.id}</div>
              </div>
            ),
          },
          { key: 'group', header: 'Group', sortValue: (r) => r.group, cell: (r) => <span className="text-muted">{r.group}</span> },
          { key: 'desc', header: 'Definition', cell: (r) => <span className="text-xs text-muted">{r.description}</span> },
          {
            key: 'used', header: 'Status', sortValue: (r) => (r.avail?.used ? 1 : 0),
            cell: (r) =>
              r.avail?.used ? (
                <Chip tone="strong">Used</Chip>
              ) : (
                <div className="flex flex-col items-start gap-1">
                  <Chip tone="neutral">Not used</Chip>
                  <span className="text-2xs text-muted">{r.avail?.reason ?? 'not in this run'}</span>
                </div>
              ),
          },
          { key: 'cov', header: 'Coverage', numeric: true, sortValue: (r) => r.avail?.coverage ?? null, cell: (r) => fmtPct(r.avail?.coverage, 0) },
          { key: 'first', header: 'Since', numeric: true, cell: (r) => fmtDate(r.avail?.firstDate) },
        ]
        return (
          <div className="space-y-6">
            <Panel
              title="Permutation importance"
              eyebrow={`Latest test year · ${run.metrics!.folds.at(-1)?.testYear ?? '—'}`}
              provenance={{ source: runProvenance(run) }}
            >
              {run.importance.length ? (
                <ImportanceBars items={run.importance} />
              ) : (
                <p className="text-sm text-muted">No importance was computed for this run.</p>
              )}
              <p className="mt-3 text-2xs text-muted">
                Drop in out-of-sample AUC when one feature is shuffled (10 repeats; whisker = ±1 sd). Near zero or negative means the model
                did not rely on it in that year. Importance explains the model, not the market, and is meaningful only if the model passes.
              </p>
            </Panel>

            {unused.length > 0 && (
              <Panel title="Not used in this run" density="dense">
                <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                  {unused.map((r) => (
                    <li key={r.id}>
                      <span className="text-foreground">{r.label}</span> — {r.avail?.reason ?? 'not in this run'}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <Panel title="Feature catalogue">
              <DataTable dense columns={columns} rows={rows} rowKey={(r) => r.id} />
            </Panel>

            <Explainer title="Look-ahead rules">
              <p>Every feature on day t uses only data dated t or earlier. Market closes are aligned to the metal&rsquo;s trading days.</p>
              <p>FRED macro series are lagged by one day. A COT report is used only from the day after its Friday release, not from its Tuesday position date.</p>
              <p>
                An optional feed (FRED, COT, futures curve) is used only when it covers at least 60% of the training history and is present
                on the latest day. Otherwise the model trains without it and lists it above.
              </p>
            </Explainer>
          </div>
        )
      }}
    </RunScope>
  )
}
