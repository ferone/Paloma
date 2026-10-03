import { existsSync, readFileSync } from 'node:fs'
import { ASSETS, UNIVERSE, type AssetId } from '../../shared/universe.js'
import { ML_TEST_COUNT, type MlPrediction } from '../../shared/ml.js'
import { exportFeatures, mlDataDir, refreshYahooInputs } from './data.js'
import { mlDeviceMode, runPipeline } from './python.js'
import {
  completeRun,
  createRun,
  failRun,
  insertPrediction,
  latestRun,
  publishArtifact,
  type PyInferResult,
  type PyTrainResult,
} from './repo.js'

// Orchestration: refresh inputs → export features → python → ingest → artifact.

export const MAX_MODEL_AGE_DAYS = 7

export interface Ctx {
  progress(fraction: number, message?: string): void
  log(message: string): void
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

/** Train one metal: new ml_runs row, full walk-forward, prediction, artifact. */
export async function trainMetal(metal: AssetId, ctx: Ctx, opts: { refresh?: boolean; publish?: boolean } = {}): Promise<string> {
  const { refresh = true, publish = true } = opts
  if (refresh) {
    ctx.progress(0.01, 'Refreshing Yahoo inputs')
    await refreshYahooInputs(ctx.log)
  }
  ctx.progress(0.03, `Exporting ${metal} features`)
  const exp = exportFeatures(metal)
  const device = mlDeviceMode()
  ctx.log(`${metal}: ${exp.rows} feature rows ${exp.dataFrom} → ${exp.dataThrough}; ML device ${device}`)
  const runId = createRun(metal)
  try {
    // --n-tests: every universe market is trained and gated, so the gate applies a Bonferroni correction over all of them.
    const path = await runPipeline(
      ['train', '--metal', metal, '--data-dir', mlDataDir(), '--n-tests', String(ML_TEST_COUNT)],
      (f, msg) => ctx.progress(0.05 + 0.93 * f, `${UNIVERSE[metal].label}: ${msg}`),
      { device },
    )
    const res = readJson<PyTrainResult>(path)
    const pred = completeRun(runId, res)
    if (publish) publishArtifact()
    const g = res.metrics.gate
    return `${UNIVERSE[metal].label} run #${runId}: ${g.status.toUpperCase()}${g.reasons.length ? ` (${g.reasons.join('; ')})` : ''} · P(up) ${pred.pUp.toFixed(3)}`
  } catch (err) {
    failRun(runId, err instanceof Error ? err.message : String(err))
    throw err
  }
}

export async function trainAll(ctx: Ctx, metals: AssetId[] = [...ASSETS]): Promise<string> {
  ctx.progress(0.01, 'Refreshing Yahoo inputs')
  await refreshYahooInputs(ctx.log)
  const out: string[] = []
  for (const [i, m] of metals.entries()) {
    const sub: Ctx = { log: ctx.log, progress: (f, msg) => ctx.progress((i + f) / metals.length, msg) }
    out.push(await trainMetal(m, sub, { refresh: false }))
  }
  return out.join(' · ')
}

/** Why the saved model for `metal` cannot be reused (null = reusable). */
export function retrainReason(metal: AssetId, now = Date.now()): string | null {
  const run = latestRun(metal, true)
  if (!run) return 'no trained model'
  if (!run.modelPath || !existsSync(run.modelPath)) return 'model file missing'
  const trained = Date.parse(run.finishedAt ?? run.startedAt)
  const age = (now - trained) / 86_400_000
  if (age > MAX_MODEL_AGE_DAYS) return `model is ${age.toFixed(1)} days old (> ${MAX_MODEL_AGE_DAYS})`
  return null
}

/**
 * Score the latest row for every metal from its saved model, retraining when
 * the model is missing, stale (> 7 days) or can no longer score today's row.
 * Always republishes the `ml:predictions` artifact.
 */
export async function inferAll(ctx: Ctx): Promise<string> {
  ctx.progress(0.01, 'Refreshing Yahoo inputs')
  await refreshYahooInputs(ctx.log)
  const out: string[] = []
  const errors: string[] = []
  for (const [i, metal] of ASSETS.entries()) {
    const sub: Ctx = { log: ctx.log, progress: (f, msg) => ctx.progress((i + f) / ASSETS.length, msg) }
    try {
      out.push(await inferMetal(metal, sub))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${metal}: ${msg}`)
      ctx.log(`Inference failed for ${metal}: ${msg}`)
    }
  }
  publishArtifact()
  if (errors.length && !out.length) throw new Error(errors.join(' · '))
  return [...out, ...errors].join(' · ')
}

async function inferMetal(metal: AssetId, ctx: Ctx): Promise<string> {
  const reason = retrainReason(metal)
  if (reason) {
    ctx.log(`${metal}: retraining (${reason})`)
    return trainMetal(metal, ctx, { refresh: false, publish: false })
  }
  const run = latestRun(metal, true)!
  exportFeatures(metal)
  ctx.progress(0.3, `${UNIVERSE[metal].label}: scoring the latest row`)
  let res: PyInferResult
  try {
    res = readJson<PyInferResult>(await runPipeline(['infer', '--metal', metal, '--data-dir', mlDataDir()]))
  } catch (err) {
    ctx.log(`${metal}: inference failed (${err instanceof Error ? err.message : err}); retraining`)
    return trainMetal(metal, ctx, { refresh: false, publish: false })
  }
  const pred: MlPrediction = insertPrediction(run.id, metal, res.prediction, res.gate, res.horizon)
  ctx.progress(1, `${UNIVERSE[metal].label}: scored ${pred.date}`)
  return `${UNIVERSE[metal].label}: P(up) ${pred.pUp.toFixed(3)} as of ${pred.date} (model #${run.id}, ${pred.validationStatus})`
}
