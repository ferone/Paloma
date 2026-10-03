import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ASSETS, MACRO_SYMBOLS, RELATIVE_VALUE_PAIRS, UNIVERSE, type AssetId } from '../../shared/universe.js'
import { featuresFor, isOptionalFor } from '../../shared/ml.js'
import { getSetting, readDailyBars, setSetting, upsertDailyBars, type DailyBar } from '../db/repo.js'
import { listContracts, readMacro, readRootBars } from '../db/shared-repo.js'
import { readSpeculator } from '../macro/cot-repo.js'
import { getHistorical } from '../services/yahoo-finance.service.js'
import { buildCurveSeries, buildOiSeries } from './curve.js'
import { buildFeatureMatrix, matrixToCsv, type FeatureMatrix, type MacroId, type PricePoint } from './features.js'

// Loads the ML inputs from SQLite (fetching Yahoo history when missing or
// stale) and writes the feature matrix for the Python pipeline.

/** Yahoo inputs: every asset's reference series, the cross-asset factors, every benchmark ETF. */
export const ML_SYMBOLS: readonly string[] = [
  ...new Set([
    ...ASSETS.map((a) => UNIVERSE[a].spot),
    MACRO_SYMBOLS.dxy,
    MACRO_SYMBOLS.us10y,
    MACRO_SYMBOLS.vix,
    MACRO_SYMBOLS.spx,
    ...ASSETS.map((a) => UNIVERSE[a].benchmarkEtf),
  ]),
]
const MACRO_IDS: MacroId[] = ['DFII10', 'T10YIE', 'DTWEXBGS', 'VIXCLS', 'GVZCLS']
/**
 * Train on the whole available history: ask Yahoo for everything it has from
 * here (each symbol then starts at its own first quote, e.g. GLD in 2004).
 */
export const HISTORY_FROM = '2000-01-01'
const STALE_DAYS = 4
/** settings key recording that the full Yahoo range was fetched for a symbol (value: ISO date). */
const fullHistoryKey = (symbol: string) => `ml.yahooFullHistory.${symbol}`

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
 * Ensure prices_daily holds the whole daily Yahoo history for `symbol`. When
 * the stored history starts after HISTORY_FROM, the full range is fetched ONCE
 * (recorded in settings, so a symbol that simply starts later — an ETF listed
 * in 2004 — is not refetched on every run); otherwise only a stale tail is
 * refreshed. Returns the number of bars written (0 when already fresh).
 */
export async function ensureYahooHistory(symbol: string, today = new Date().toISOString().slice(0, 10)): Promise<number> {
  const bars = yahooBars(symbol)
  const first = bars[0]?.date
  const last = bars.at(-1)?.date
  // (a few days' grace: the first session of 2000 was Jan 3)
  const startsLate = !!first && daysBetween(HISTORY_FROM, first) > 10
  const needsFull = !first || (startsLate && !getSetting<string | null>(fullHistoryKey(symbol), null))
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
  const written = upsertDailyBars([...byDate.values()])
  if (needsFull && rows.length) setSetting(fullHistoryKey(symbol), today)
  return written
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

/** The relative-value pair an asset belongs to (first match), or null. */
function pairOf(asset: AssetId) {
  return RELATIVE_VALUE_PAIRS.find((p) => p.numerator === asset || p.denominator === asset) ?? null
}

/** Build the feature matrix for one asset from what is currently in the DB. */
export function loadFeatureMatrix(metal: AssetId): FeatureMatrix {
  const spec = UNIVERSE[metal]
  const front = spec.futures[0]
  const macro: Partial<Record<MacroId, { date: string; value: number }[]>> = {}
  for (const id of MACRO_IDS) {
    const pts = readMacro(id)
    if (pts.length) macro[id] = pts.map((p) => ({ date: p.date, value: p.value }))
  }
  const rootBars = front ? readRootBars(front.root) : []
  const contracts = front ? listContracts(front.root) : []
  const curve = front ? buildCurveSeries(rootBars, contracts, front.activeMonths) : []
  const oi = front ? buildOiSeries(rootBars, contracts) : []
  const pair = pairOf(metal)
  return buildFeatureMatrix({
    metal,
    spot: toPoints(yahooBars(spec.spot)),
    pair: pair
      ? { numerator: toPoints(yahooBars(UNIVERSE[pair.numerator].spot)), denominator: toPoints(yahooBars(UNIVERSE[pair.denominator].spot)) }
      : null,
    dxy: toPoints(yahooBars(MACRO_SYMBOLS.dxy)),
    tnx: toPoints(yahooBars(MACRO_SYMBOLS.us10y)),
    vix: toPoints(yahooBars(MACRO_SYMBOLS.vix)),
    spy: toPoints(yahooBars(MACRO_SYMBOLS.spx)),
    etf: toPoints(yahooBars(spec.benchmarkEtf)),
    macro,
    // Speculator positions: managed money (disagg) or leveraged funds (TFF).
    cot: spec.cot
      ? readSpeculator(spec.cot.market, spec.cot.report).map((r) => ({
          reportDate: r.reportDate,
          publishedAt: r.publishedAt,
          openInterest: r.openInterest,
          specLong: r.long,
          specShort: r.short,
        }))
      : [],
    curve,
    oi,
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

/** Write data/ml/features_<asset>.csv (+ meta JSON with missing-feature reasons). */
export function exportFeatures(metal: AssetId, dir = mlDataDir()): ExportedFeatures {
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
    features: featuresFor(metal).map((f) => ({ id: f.id, optional: isOptionalFor(f, metal) })),
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2))
  return { csvPath, metaPath, rows: m.rows.length, dataFrom: meta.dataFrom, dataThrough: meta.dataThrough, missing: m.missing }
}
