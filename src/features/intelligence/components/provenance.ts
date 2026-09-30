import type { MlRunSummary } from '@shared/ml'
import { fmtDate } from '../../../design/format'

/** "Model run #12 · trained 30 Sep 2026 · data through 30 Sep 2026". */
export function runProvenance(run: Pick<MlRunSummary, 'id' | 'finishedAt' | 'dataThrough'>): string {
  return `Model run #${run.id} · trained ${fmtDate(run.finishedAt)} · data through ${fmtDate(run.dataThrough)}`
}
