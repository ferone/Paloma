import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { UNIVERSE, type Metal } from '../../shared/universe.js'
import { FEATURES } from '../../shared/ml.js'
import { readDailyBars, upsertDailyBars, type DailyBar } from '../db/repo.js'
import { listContracts, readCot, readMacro, readRootBars } from '../db/shared-repo.js'
import { getHistorical } from '../services/yahoo-finance.service.js'
import { buildCurveSeries } from './curve.js'
import { buildFeatureMatrix, matrixToCsv, type FeatureMatrix, type MacroId, type PricePoint } from './features.js'

// Loads the ML inputs from SQLite (fetching Yahoo history when missing or
// stale) and writes the feature matrix for the Python pipeline.

export const ML_SYMBOLS = ['GC=F', 'SI=F', 'DX-Y.NYB', '^TNX', '^VIX', 'SPY', 'GLD', 'SLV'] as const
const MACRO_IDS: MacroId[] = ['DFII10', 'T10YIE', 'DTWEXBGS', 'VIXCLS', 'GVZCLS']
/** We want at least this much history (≥15 years) where Yahoo has it. */
const HISTORY_FROM = '2008-01-01'
const STALE_DAYS = 4

export function mlDataDir(): string {
  return resolve(process.env.ML_DATA_DIR || 'data/ml')
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000
}

function yahooBars(symbol: string): DailyBar[] {
  return readDailyBars(symbol, { source: 'yahoo' })
}

/**
 * Ensure prices_daily holds long daily Yahoo history for `symbol`. Refetches the
 * full range when the first bar is too recent or the last bar is stale.
 * Returns the number of bars written (0 when already fresh).
 */
export async function ensureYahooHistory(symbol: string, today = new Date().toISOString().slice(0, 10)): Promise<number> {
  const bars = yahooBars(symbol)
  const first = bars[0]?.date
  const last = bars.at(-1)?.date
  const needsFull = !first || first > HISTORY_FROM
  const stale = !last || daysBetween(last, today) > STALE_DAYS
  if (!needsFull && !stale) return 0
  const raw = (await getHistorical(symbol, { range: needsFull ? 'ALL' : '1Y', interval: '1d' })) as {
    date: string
    open: number
    high: number
    low: number
    close: number
    volume: number
  }[]
  const rows: DailyBar[] = raw
    .filter((q) => q.close > 0)
    .map((q) => ({
      symbol,
      date: q.date.slice(0, 10),
      open: q.open || null,
      high: q.high || null,
      low: q.low || null,
      close: q.close,
      volume: q.volume || null,
      source: 'yahoo',
    }))
  // Deduplicate by date (keep the last quote for a day).
  const byDate = new Map(rows.map((r) => [r.date, r]))
  return upsertDailyBars([...byDate.values()])
}

export async function refreshYahooInputs(log: (m: string) => void = () => {}): Promise<Record<string, string>> {
  const errors: Record<string, string> = {}
  for (const s of ML_SYMBOLS) {
    try {
      const n = await ensureYahooHistory(s)
      if (n > 0) log(`Fetched ${n} Yahoo bars for ${s}`)
    } catch (err) {
      // Keep going with whatever is cached; the matrix builder degrades.
      errors[s] = err instanceof Error ? err.message : String(err)
      log(`Yahoo fetch failed for ${s}: ${errors[s]}`)
    }
  }
  return errors
}

const toPoints = (bars: DailyBar[]): PricePoint[] => bars.map((b) => ({ date: b.date, close: b.close, volume: b.volume ?? null }))

/** Build the feature matrix for one metal from what is currently in the DB. */
export function loadFeatureMatrix(metal: Metal): FeatureMatrix {
  const spec = UNIVERSE[metal]
  const front = spec.futures[0]
  const macro: Partial<Record<MacroId, { date: string; value: number }[]>> = {}
  for (const id of MACRO_IDS) {
    const pts = readMacro(id)
    if (pts.length) macro[id] = pts.map((p) => ({ date: p.date, value: p.value }))
  }
  const curve = buildCurveSeries(readRootBars(front.root), listContracts(front.root), front.activeMonths)
  return buildFeatureMatrix({
    metal,
    spot: toPoints(yahooBars(spec.spot)),
    gold: toPoints(yahooBars('GC=F')),
    silver: toPoints(yahooBars('SI=F')),
    dxy: toPoints(yahooBars('DX-Y.NYB')),
    tnx: toPoints(yahooBars('^TNX')),
    vix: toPoints(yahooBars('^VIX')),
    spy: toPoints(yahooBars('SPY')),
    etf: toPoints(yahooBars(metal === 'gold' ? 'GLD' : 'SLV')),
    macro,
    cot: readCot(spec.cotMarket).map((r) => ({
      reportDate: r.reportDate,
      publishedAt: r.publishedAt,
      openInterest: r.openInterest,
      mmLong: r.mmLong,
      mmShort: r.mmShort,
    })),
    curve,
  })
}

export interface ExportedFeatures {
  csvPath: string
  metaPath: string
  rows: number
  dataFrom: string | null
  dataThrough: string | null
  missing: Record<string, string>
}

/** Write data/ml/features_<metal>.csv (+ meta JSON with missing-feature reasons). */
export function exportFeatures(metal: Metal, dir = mlDataDir()): ExportedFeatures {
  const m = loadFeatureMatrix(metal)
  if (m.rows.length < 500) {
    throw new Error(`Not enough ${UNIVERSE[metal].spot} history in prices_daily (${m.rows.length} rows)`)
  }
  mkdirSync(dir, { recursive: true })
  const csvPath = join(dir, `features_${metal}.csv`)
  const metaPath = join(dir, `features_${metal}.meta.json`)
  writeFileSync(csvPath, matrixToCsv(m))
  const meta = {
    metal,
    horizon: m.horizon,
    generatedAt: new Date().toISOString(),
    rows: m.rows.length,
    dataFrom: m.rows[0]?.date ?? null,
    dataThrough: m.rows.at(-1)?.date ?? null,
    missing: m.missing,
    features: FEATURES.map((f) => ({ id: f.id, optional: f.optional })),
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2))
  return { csvPath, metaPath, rows: m.rows.length, dataFrom: meta.dataFrom, dataThrough: meta.dataThrough, missing: m.missing }
}
