import { beforeEach, describe, expect, it } from 'vitest'
import { ARTIFACTS, type MlPredictionsLite } from '../../shared/artifacts.js'
import type { MlGate } from '../../shared/ml.js'
import { useTestDb } from '../db/client.js'
import { readArtifact } from '../db/repo.js'
import {
  completeRun,
  createRun,
  failRun,
  getRun,
  insertPrediction,
  latestPredictions,
  latestRun,
  listRuns,
  publishArtifact,
  type PyTrainResult,
} from './repo.js'
import { retrainReason } from './service.js'

const failedGate: MlGate = {
  status: 'failed',
  reasons: ['AUC 0.458 < 0.55'],
  checks: [{ id: 'auc', label: 'Mean walk-forward AUC', value: 0.458, threshold: 0.55, ok: false }],
}

function trainResult(metal: 'gold' | 'silver', over: Partial<PyTrainResult> = {}): PyTrainResult {
  return {
    kind: 'train',
    metal,
    horizon: 20,
    trainedAt: '2026-10-01T00:00:00+00:00',
    params: { horizon: 20, nPerm: 100, minTrainYears: 5, model: 'gbm', baseline: 'logit' },
    featuresUsed: ['mom20', 'rv20'],
    availability: [
      { id: 'mom20', used: true, coverage: 1, firstDate: '2000-09-28' },
      { id: 'cot_mm_z', used: false, reason: 'COT not loaded yet', coverage: 0, firstDate: null },
    ],
    metrics: {
      summary: { folds: 17, auc: 0.458, hit: 0.52, brier: 0.258, baseRate: 0.54, baselineAuc: 0.525, baselineHit: 0.5, rmse: 0.05, ic: 0.09, pooledAuc: 0.457 },
      folds: [
        { testYear: 2025, nTrain: 5000, nTest: 250, purged: 20, auc: 0.56, hit: 0.82, brier: 0.2, baseRate: 0.82, baselineAuc: 0.7, baselineHit: 0.8, rmse: 0.04, ic: 0.1 },
      ],
      permutation: { holdoutYear: 2026, realAuc: 0.44, nullAucs: [0.5, 0.6], nullMean: 0.5, null95: 0.73, nPerm: 100, pValue: 0.72, method: 'block' },
      gate: failedGate,
      residualQuantiles: { q10: -0.06, q90: 0.05 },
      nRows: 5355,
      dataFrom: '2005-11-18',
      dataThrough: '2026-09-30',
      labelThrough: '2026-09-01',
      durationSec: 180,
      sklearnVersion: '1.6.1',
    },
    importance: [{ feature: 'mom20', mean: 0.02, std: 0.01 }],
    calibration: [{ lo: 0.5, hi: 0.6, meanPredicted: 0.55, observed: 0.56, count: 2600 }],
    modelPath: '/nonexistent/model_gold.joblib',
    prediction: { date: '2026-09-30', pUp: 0.586, pUpLow: 0.545, pUpHigh: 0.57, expectedMove: -0.011, lower: -0.078, upper: 0.047 },
    ...over,
  }
}

describe('ml repo: run ingestion', () => {
  beforeEach(() => {
    useTestDb()
  })

  it('stores a finished run with metrics, gate and prediction', () => {
    const id = createRun('gold')
    expect(latestRun('gold')?.status).toBe('running')
    const pred = completeRun(id, trainResult('gold'))
    expect(pred).toMatchObject({ runId: id, metal: 'gold', instrumentId: 'GC.out', pUp: 0.586, validationStatus: 'failed' })
    expect(pred.reasons).toEqual(['AUC 0.458 < 0.55'])
    expect(pred.trainedAt).toBe('2026-10-01T00:00:00+00:00')

    const run = getRun(id)!
    expect(run.status).toBe('succeeded')
    expect(run.validationStatus).toBe('failed')
    expect(run.auc).toBe(0.458)
    expect(run.pValue).toBe(0.72)
    expect(run.folds).toBe(17)
    expect(run.dataThrough).toBe('2026-09-30')
    expect(run.metrics?.folds[0].testYear).toBe(2025)
    expect(run.availability.find((a) => a.id === 'cot_mm_z')?.reason).toBe('COT not loaded yet')
    expect(run.importance[0].feature).toBe('mom20')
    expect(listRuns('gold')).toHaveLength(1)
    expect(listRuns('silver')).toHaveLength(0)
  })

  it('records failures without metrics', () => {
    const id = createRun('silver')
    failRun(id, 'pipeline.py train exited with 1')
    const run = getRun(id)!
    expect(run).toMatchObject({ status: 'failed', error: 'pipeline.py train exited with 1', metrics: null })
    expect(latestRun('silver', true)).toBeNull()
  })

  it('returns the latest prediction per metal and publishes the artifact', () => {
    const g = createRun('gold')
    completeRun(g, trainResult('gold'))
    insertPrediction(g, 'gold', { ...trainResult('gold').prediction, date: '2026-10-01', pUp: 0.6 }, failedGate)
    const s = createRun('silver')
    completeRun(s, trainResult('silver', { prediction: { date: '2026-09-30', pUp: 0.41, pUpLow: null, pUpHigh: null, expectedMove: 0.02, lower: null, upper: null } }))

    const latest = latestPredictions()
    expect(latest.map((p) => [p.metal, p.date, p.pUp])).toEqual([
      ['gold', '2026-10-01', 0.6],
      ['silver', '2026-09-30', 0.41],
    ])
    expect(latestPredictions('silver')).toHaveLength(1)

    publishArtifact()
    const art = readArtifact<MlPredictionsLite>(ARTIFACTS.mlPredictions)!.data
    expect(art.modelRunId).toBe(s)
    expect(art.predictions.map((p) => p.instrumentId)).toEqual(['GC.out', 'SI.out'])
    expect(art.predictions[0]).toMatchObject({ asset: 'gold', horizonDays: 20, pUp: 0.6, validationStatus: 'failed', asOf: '2026-10-01' })
  })

  it('asks for a retrain when the model is missing or stale', () => {
    expect(retrainReason('gold')).toBe('no trained model')
    const id = createRun('gold')
    completeRun(id, trainResult('gold'))
    expect(retrainReason('gold')).toBe('model file missing')
  })
})
