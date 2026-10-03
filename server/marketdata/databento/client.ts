import { DATABENTO_DATASET, type DatabentoSchema } from '../../../shared/marketdata.js'
import { decodeSymbology } from './parse.js'

// Thin Databento Historical HTTP client (hist.databento.com, HTTP Basic auth
// with the API key as the username). Server-only. `fetchImpl` is injectable so
// the cost guard can be tested without network.

const HOST = 'https://hist.databento.com/v0'

export interface ClientOptions {
  apiKey: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Retries for transient failures (429, 5xx, network). */
  tries?: number
  /** Base backoff in ms (doubles each retry, capped at 8 s). */
  backoffMs?: number
}

export class DatabentoHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class DatabentoClient {
  private readonly auth: string
  private readonly f: typeof fetch
  private readonly timeoutMs: number
  private readonly tries: number
  private readonly backoffMs: number

  constructor(opts: ClientOptions) {
    if (!opts.apiKey) throw new Error('DATABENTO_API_KEY is not set')
    this.auth = 'Basic ' + Buffer.from(`${opts.apiKey}:`).toString('base64')
    this.f = opts.fetchImpl ?? fetch
    // Generous: the statistics (open interest) schema is slow server-side (~90 s per
    // month of data), so a multi-month request can legitimately take many minutes.
    this.timeoutMs = opts.timeoutMs ?? 900_000
    this.tries = opts.tries ?? 5
    this.backoffMs = opts.backoffMs ?? 500
  }

  /** GET with exponential backoff on 429/5xx/network errors; 4xx other than 429 fail fast. */
  private async get(path: string, params: Record<string, string>): Promise<string> {
    const url = `${HOST}/${path}?${new URLSearchParams(params).toString()}`
    let lastErr: unknown
    for (let i = 0; i < this.tries; i++) {
      try {
        const res = await this.f(url, { headers: { Authorization: this.auth }, signal: AbortSignal.timeout(this.timeoutMs) })
        const text = await res.text()
        if (res.ok) return text
        const err = new DatabentoHttpError(`Databento ${path} ${res.status}: ${text.slice(0, 300)}`, res.status)
        if (res.status !== 429 && res.status < 500) throw err
        lastErr = err
      } catch (err) {
        if (err instanceof DatabentoHttpError && err.status !== 429 && err.status < 500) throw err
        lastErr = err
      }
      if (i < this.tries - 1) await sleep(Math.min(8000, this.backoffMs * 2 ** i))
    }
    throw lastErr
  }

  /** FREE: USD cost of a query, without downloading anything. */
  async getCost(q: { symbols: string[]; stypeIn: string; schema: DatabentoSchema; start: string; end: string }): Promise<number> {
    const text = await this.get('metadata.get_cost', {
      dataset: DATABENTO_DATASET,
      symbols: q.symbols.join(','),
      stype_in: q.stypeIn,
      schema: q.schema,
      start: q.start,
      end: q.end,
      mode: 'historical',
    })
    const cost = Number(text.trim())
    if (!Number.isFinite(cost)) throw new Error(`Databento get_cost: unexpected body ${text.slice(0, 100)}`)
    return cost
  }

  /** FREE: the available history window, per schema when reported. */
  async getDatasetRange(): Promise<{ start: string; end: string; schema: Record<string, { start: string; end: string }> }> {
    const body = JSON.parse(await this.get('metadata.get_dataset_range', { dataset: DATABENTO_DATASET })) as {
      start: string
      end: string
      schema?: Record<string, { start: string; end: string }>
    }
    return { start: body.start, end: body.end, schema: body.schema ?? {} }
  }

  /** PAID: raw JSON-lines body of timeseries.get_range (symbols mapped onto records). */
  async getRange(q: { symbols: string[]; stypeIn: string; schema: DatabentoSchema; start: string; end: string }): Promise<string> {
    return this.get('timeseries.get_range', {
      dataset: DATABENTO_DATASET,
      symbols: q.symbols.join(','),
      stype_in: q.stypeIn,
      schema: q.schema,
      start: q.start,
      end: q.end,
      encoding: 'json',
      map_symbols: 'true',
    })
  }

  /** FREE: instrument_id → raw_symbol over a date range (fallback when records lack `symbol`). */
  async resolveInstrumentIds(ids: number[], start: string, end: string): Promise<Record<number, string>> {
    const uniq = [...new Set(ids)].filter((id) => Number.isFinite(id) && id > 0)
    if (!uniq.length) return {}
    const text = await this.get('symbology.resolve', {
      dataset: DATABENTO_DATASET,
      symbols: uniq.join(','),
      stype_in: 'instrument_id',
      stype_out: 'raw_symbol',
      start_date: start,
      end_date: end,
    })
    return decodeSymbology(JSON.parse(text))
  }
}
