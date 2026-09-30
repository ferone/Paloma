import type { ReactNode } from 'react'
import type { MlRunDetail } from '@shared/ml'
import { UNIVERSE } from '@shared/universe'
import { useSettings } from '../../../store/settings-context'
import { EmptyState, ErrorNote, Panel, PanelSkeleton } from '../../../ui'
import { useLatestRun } from '../api'
import { JobControls } from './JobControls'

/** Loads the latest successful run for the selected metal, or explains why there is none. */
export function RunScope({ children }: { children: (run: MlRunDetail) => ReactNode }) {
  const { metal } = useSettings()
  const { run, isLoading, error, refetch } = useLatestRun(metal)
  if (isLoading) return <Panel><PanelSkeleton rows={6} /></Panel>
  if (error) return <Panel><ErrorNote error={error} onRetry={refetch} /></Panel>
  if (!run || !run.metrics) {
    return (
      <Panel>
        <EmptyState title={`No trained ${UNIVERSE[metal].label.toLowerCase()} model yet`}
          action={<JobControls metal={metal} />}>
          Training exports the feature matrix, runs the walk-forward validation and the permutation test, and stores the results here.
        </EmptyState>
      </Panel>
    )
  }
  return <>{children(run)}</>
}
