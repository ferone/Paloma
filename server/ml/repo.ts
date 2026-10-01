import { ARTIFACTS, type MlPredictionsLite } from '../../shared/artifacts.js'
import {
  ML_HORIZON,
  ML_INSTRUMENT,
  type FeatureAvailability,
  type MlCalibrationBin,
  type MlGate,
  type MlImportance,
  type MlMetrics,
  type MlPrediction,
  type MlRunDetail,
  type MlRunParams,
  type MlRunSummary,
  type ValidationStatus,
} from '../../shared/ml.js'
import { ASSETS, type AssetId } from '../../shared/universe.js'
import { getDb } from '../db/client.js'
import { writeArtifact } from '../db/repo.js'

// Persistence for ml_runs / ml_predictions (migration 050) and the
// cross-domain `ml:predictions` artifact.

/** JSON written by `ml/pipeline.py train`. */
export interface PyPrediction {
  date: string
  pUp: number
  pUpLow: number | null
  pUpHigh: number | null
  expectedMove: number
  lower: number | null
  upper: number | null
}

export interface PyTrainResult {
  kind: 'train'
  metal: AssetId
  horizon: number
  trainedAt: string
  params: MlRunParams
  featuresUsed: string[]
  availability: FeatureAvailability[]
  metrics: MlMetrics
  importance: MlImportance[]
  calibration: MlCalibrationBin[]
  modelPath: string
  prediction: PyPrediction
}

/** JSON written by `ml/pipeline.py infer`. */
export interface PyInferResult {
  kind: 'infer'
  metal: AssetId
  horizon: number
  trainedAt: string
  modelPath: string
  gate: MlGate
  prediction: PyPrediction
}

interface RunRow {
  id: number
  metal: AssetId
  started_at: string
  finished_at: string | null
  status: MlRunSummary['status']
  params: string | null
  features_used: string | null
  availability: string | null
  metrics: string | null
  validation_status: ValidationStatus | null
  auc: number | null
  permutation_p: number | null
  importance: string | null
  calibration: string | null
  model_path: string | null
  data_through: string | null
  trained_at: string | null
  error: string | null
}

const parse = <T>(s: string | null, fallback: T): T => (s ? (JSON.parse(s) as T) : fallback)
const now = () => new Date().toISOString()

function toSummary(r: RunRow): MlRunSummary {
  const metrics = parse<MlMetrics | null>(r.metrics, null)
  return {
    id: r.id,
    metal: r.metal,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    validationStatus: r.validation_status,
    auc: r.auc,
    pValue: r.permutation_p,
    folds: metrics?.summary.folds ?? null,
    dataThrough: r.data_through,
    error: r.error,
  }
}

function toDetail(r: RunRow): MlRunDetail {
  return {
    ...toSummary(r),
    params: parse<MlRunParams | null>(r.params, null),
    featuresUsed: parse<string[]>(r.features_used, []),
    availability: parse<FeatureAvailability[]>(r.availability, []),
    metrics: parse<MlMetrics | null>(r.metrics, null),
    importance: parse<MlImportance[]>(r.importance, []),
    calibration: parse<MlCalibrationBin[]>(r.calibration, []),
    modelPath: r.model_path,
  }
}

export function createRun(metal: AssetId): number {
  return Number(
    getDb().prepare(`INSERT INTO ml_runs (metal, started_at, status) VALUES (?, ?, 'running')`).run(metal, now()).lastInsertRowid,
  )
}

export function failRun(id: number, error: string): void {
  getDb().prepare(`UPDATE ml_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?`).run(now(), error.slice(0, 2000), id)
}

/** Runs still 'running' after a restart were interrupted: mark them failed. */
export function markInterruptedRuns(): number {
  return getDb()
    .prepare(`UPDATE ml_runs SET status = 'failed', finished_at = ?, error = 'Interrupted (server restarted during training)' WHERE status = 'running'`)
    .run(now()).changes
}

/** Store a finished training run and the prediction it produced. */
export function completeRun(id: number, res: PyTrainResult): MlPrediction {
  const m = res.metrics
  getDb()
    .prepare(
      `UPDATE ml_runs SET status = 'succeeded', finished_at = ?, params = ?, features_used = ?, availability = ?,
         metrics = ?, validation_status = ?, auc = ?, permutation_p = ?, importance = ?, calibration = ?,
         model_path = ?, data_through = ?, trained_at = ?, error = NULL
       WHERE id = ?`,
    )
    .run(
      now(),
      JSON.stringify(res.params),
      JSON.stringify(res.featuresUsed),
      JSON.stringify(res.availability),
      JSON.stringify(m),
      m.gate.status,
      m.summary.auc,
      m.permutation?.pValue ?? null,
      JSON.stringify(res.importance),
      JSON.stringify(res.calibration),
      res.modelPath,
      m.dataThrough,
      res.trainedAt,
      id,
    )
  return insertPrediction(id, res.metal, res.prediction, m.gate, res.horizon)
}

export function insertPrediction(runId: number, metal: AssetId, p: PyPrediction, gate: MlGate, horizon = ML_HORIZON): MlPrediction {
  const createdAt = now()
  const id = Number(
    getDb()
      .prepare(
        `INSERT INTO ml_predictions (run_id, metal, instrument_id, date, horizon_days, p_up, p_up_low, p_up_high,
           expected_move, lower, upper, validation_status, reasons, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        metal,
        ML_INSTRUMENT[metal],
        p.date,
        horizon,
        p.pUp,
        p.pUpLow,
        p.pUpHigh,
        p.expectedMove,
        p.lower,
        p.upper,
        gate.status,
        JSON.stringify(gate.reasons),
        createdAt,
      ).lastInsertRowid,
  )
  return getPrediction(id)!
}

interface PredRow {
  id: number
  run_id: number
  metal: AssetId
  instrument_id: string
  date: string
  horizon_days: number
  p_up: number
  p_up_low: number | null
  p_up_high: number | null
  expected_move: number
  lower: number | null
  upper: number | null
  validation_status: ValidationStatus
  reasons: string | null
  created_at: string
  trained_at: string | null
}

const PRED_SELECT = `SELECT p.*, r.trained_at FROM ml_predictions p JOIN ml_runs r ON r.id = p.run_id`

function toPrediction(r: PredRow): MlPrediction {
  return {
    runId: r.run_id,
    metal: r.metal,
    instrumentId: r.instrument_id,
    date: r.date,
    horizonDays: r.horizon_days,
    pUp: r.p_up,
    pUpLow: r.p_up_low,
    pUpHigh: r.p_up_high,
    expectedMove: r.expected_move,
    lower: r.lower,
    upper: r.upper,
    validationStatus: r.validation_status,
    reasons: parse<string[]>(r.reasons, []),
    createdAt: r.created_at,
    trainedAt: r.trained_at,
  }
}

function getPrediction(id: number): MlPrediction | null {
  const r = getDb().prepare(`${PRED_SELECT} WHERE p.id = ?`).get(id) as PredRow | undefined
  return r ? toPrediction(r) : null
}

/** Latest prediction per metal (optionally one metal). */
export function latestPredictions(metal?: AssetId): MlPrediction[] {
  const metals = metal ? [metal] : [...ASSETS]
  const stmt = getDb().prepare(`${PRED_SELECT} WHERE p.metal = ? ORDER BY p.id DESC LIMIT 1`)
  return metals.flatMap((m) => {
    const r = stmt.get(m) as PredRow | undefined
    return r ? [toPrediction(r)] : []
  })
}

export function listRuns(metal?: AssetId, limit = 50): MlRunSummary[] {
  const rows = getDb()
    .prepare(`SELECT * FROM ml_runs WHERE (? IS NULL OR metal = ?) ORDER BY id DESC LIMIT ?`)
    .all(metal ?? null, metal ?? null, limit) as RunRow[]
  return rows.map(toSummary)
}

export function getRun(id: number): MlRunDetail | null {
  const r = getDb().prepare(`SELECT * FROM ml_runs WHERE id = ?`).get(id) as RunRow | undefined
  return r ? toDetail(r) : null
}

export function latestRun(metal: AssetId, succeededOnly = false): MlRunDetail | null {
  const r = getDb()
    .prepare(`SELECT * FROM ml_runs WHERE metal = ? AND (? = 0 OR status = 'succeeded') ORDER BY id DESC LIMIT 1`)
    .get(metal, succeededOnly ? 1 : 0) as RunRow | undefined
  return r ? toDetail(r) : null
}

/** Build and publish `ml:predictions` from the latest prediction per metal. */
export function publishArtifact(): MlPredictionsLite {
  const preds = latestPredictions()
  const lite: MlPredictionsLite = {
    asOf: now(),
    modelRunId: preds.length ? Math.max(...preds.map((p) => p.runId)) : null,
    predictions: preds.map((p) => ({
      instrumentId: p.instrumentId,
      asset: p.metal,
      horizonDays: p.horizonDays,
      pUp: p.pUp,
      expectedMove: p.expectedMove,
      validationStatus: p.validationStatus,
      asOf: p.date,
    })),
  }
  writeArtifact(ARTIFACTS.mlPredictions, lite)
  return lite
}
