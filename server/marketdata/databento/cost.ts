import {
  DATABENTO_DATASET,
  DATABENTO_HISTORY_START,
  type CostEstimate,
  type CostLine,
  type EstimateRequest,
} from '../../../shared/marketdata.js'
import type { DatabentoClient } from './client.js'

// Credit guard. Every paid pull is preceded by the FREE metadata.get_cost
// estimate; the pull is refused when the estimate exceeds the allowed limit.

export class OverBudgetError extends Error {
  constructor(
    readonly estimate: CostEstimate,
    readonly limit: number,
  ) {
    super(
      `Estimated cost $${estimate.total.toFixed(4)} exceeds the allowed $${limit.toFixed(2)}` +
        (limit === estimate.budget ? ' (DATABENTO_BUDGET). Pass an explicit maxCost to override.' : ' (maxCost).'),
    )
  }
}

/**
 * The spending limit for a pull: an explicit `maxCost` when given (it may
 * raise the cap above DATABENTO_BUDGET, or tighten it), otherwise the budget.
 */
export function costLimit(budget: number, maxCost?: number | null): number {
  return maxCost != null && Number.isFinite(maxCost) && maxCost >= 0 ? maxCost : budget
}

/** Throw OverBudgetError unless the estimate fits the limit. PURE. */
export function assertWithinBudget(estimate: CostEstimate, maxCost?: number | null): void {
  const limit = costLimit(estimate.budget, maxCost)
  if (!(estimate.total <= limit)) throw new OverBudgetError(estimate, limit)
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Clamp a request to the licensed window: start ≥ 2010-06-06, end ≤ the
 * dataset's available end (Databento rejects ranges past it). Dates are
 * YYYY-MM-DD; `end` is exclusive.
 */
export function clampRange(start: string, end: string | undefined, availableEnd: string): { start: string; end: string } {
  if (!ISO.test(start)) throw new Error(`Invalid start date: ${start}`)
  if (end && !ISO.test(end)) throw new Error(`Invalid end date: ${end}`)
  const s = start < DATABENTO_HISTORY_START ? DATABENTO_HISTORY_START : start
  const availDay = availableEnd.slice(0, 10)
  const e = !end || end > availDay ? availDay : end
  if (e <= s) throw new Error(`Empty range: ${s} → ${e} (data available through ${availDay})`)
  return { start: s, end: e }
}

/** FREE estimate of a request: one get_cost per (root, schema). */
export async function estimate(
  client: DatabentoClient,
  req: EstimateRequest,
  budget: number,
  availableEnd?: string,
): Promise<CostEstimate> {
  const avail = availableEnd ?? (await client.getDatasetRange()).end
  const { start, end } = clampRange(req.start, req.end, avail)
  const lines: CostLine[] = []
  for (const root of req.roots) {
    for (const schema of req.schemas) {
      const cost = await client.getCost({ symbols: [`${root}.FUT`], stypeIn: 'parent', schema, start, end })
      lines.push({ root, schema, cost })
    }
  }
  const total = Math.round(lines.reduce((s, l) => s + l.cost, 0) * 1e6) / 1e6
  return { dataset: DATABENTO_DATASET, start, end, lines, total, budget, withinBudget: total <= budget }
}
