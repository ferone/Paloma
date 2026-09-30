import type { MlCalibrationBin } from '@shared/ml'
import { fmtNum, fmtPct, fmtSigned } from '../../../design/format'
import { DataTable, Explainer, Panel, type Column } from '../../../ui'
import { ReliabilityDiagram } from '../components/charts'
import { runProvenance } from '../components/provenance'
import { RunScope } from '../components/RunScope'

export default function CalibrationPage() {
  return (
    <RunScope>
      {(run) => {
        const bins = run.calibration.filter((b) => b.count > 0)
        const total = bins.reduce((a, b) => a + b.count, 0)
        const columns: Column<MlCalibrationBin>[] = [
          { key: 'bin', header: 'Predicted bin', cell: (b) => <span className="num">{fmtPct(b.lo, 0)}–{fmtPct(b.hi, 0)}</span> },
          { key: 'n', header: 'Days', numeric: true, cell: (b) => b.count.toLocaleString('en-US') },
          { key: 'pred', header: 'Mean predicted', numeric: true, cell: (b) => fmtPct(b.meanPredicted, 1) },
          { key: 'obs', header: 'Observed up', numeric: true, cell: (b) => fmtPct(b.observed, 1) },
          {
            key: 'gap', header: 'Gap (pts)', numeric: true,
            cell: (b) => (b.observed != null && b.meanPredicted != null ? fmtSigned((b.observed - b.meanPredicted) * 100, 1) : '—'),
          },
        ]
        return (
          <div className="space-y-6">
            <Panel title="Reliability diagram" eyebrow="All out-of-sample predictions" provenance={{ source: runProvenance(run) }}>
              {bins.length ? (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
                  <ReliabilityDiagram bins={run.calibration} />
                  <div>
                    <DataTable dense columns={columns} rows={bins} rowKey={(b) => String(b.lo)} />
                    <p className="mt-3 text-2xs text-muted">
                      {total.toLocaleString('en-US')} out-of-sample days across {run.metrics!.summary.folds} test years · mean Brier{' '}
                      <span className="num">{fmtNum(run.metrics!.summary.brier, 3)}</span>. Dot size ∝ number of days.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">No out-of-sample predictions in this run.</p>
              )}
            </Panel>
            <Explainer title="What calibration means">
              <p>
                A calibrated model&rsquo;s probabilities mean what they say: of all days it reported about 60%, about 60% should have been
                followed by a higher price 20 days later. Points on the dashed diagonal are well calibrated; points below it are over-confident.
              </p>
              <p>
                Calibration and skill are separate. A model that always says the long-run up share is perfectly calibrated and useless. Check
                that the predictions spread across several bins and that the Validation tab passes.
              </p>
            </Explainer>
          </div>
        )
      }}
    </RunScope>
  )
}
