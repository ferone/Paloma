import { beforeEach, describe, expect, it } from 'vitest'
import { Writable } from 'node:stream'
import type { Response } from 'express'
import { useTestDb } from '../db/client.js'
import { upsertDailyBars } from '../db/repo.js'
import { upsertContractBars, upsertContracts } from '../db/shared-repo.js'
import { csvField, csvRow, toCsv } from './csv.js'
import { ExportNotFoundError, buildExportQuery, exportFilename, streamExport } from './export.js'

describe('RFC 4180 CSV', () => {
  it('quotes only when needed and doubles embedded quotes', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
    expect(csvField('cr\rhere')).toBe('"cr\rhere"')
    expect(csvField(' spaced ')).toBe(' spaced ')
  })
  it('renders null/undefined/NaN as empty fields and numbers verbatim', () => {
    expect(csvRow([null, undefined, Number.NaN, 0, -1.5, 4210.25])).toBe(',,,0,-1.5,4210.25\r\n')
  })
  it('serializes objects as quoted JSON', () => {
    expect(csvField({ a: 1, b: 'x' })).toBe('"{""a"":1,""b"":""x""}"')
  })
  it('builds a document with a header row and CRLF record separators', () => {
    expect(toCsv(['name', 'note'], [{ name: 'GC', note: 'gold, 100oz' }, { name: 'SI', note: null }])).toBe('name,note\r\nGC,"gold, 100oz"\r\nSI,\r\n')
  })
})

/** Minimal Response stand-in that captures headers and the streamed body. */
function captureResponse() {
  const chunks: string[] = []
  const headers: Record<string, string> = {}
  const w = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk))
      cb()
    },
  }) as Writable & Partial<Response>
  let statusCode = 0
  Object.assign(w, {
    status(code: number) {
      statusCode = code
      return w
    },
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v
    },
  })
  const done = new Promise<void>((r) => w.on('finish', () => r()))
  return { res: w as unknown as Response, body: () => chunks.join(''), headers, status: () => statusCode, done }
}

describe('export whitelist and queries', () => {
  beforeEach(() => {
    const db = useTestDb()
    upsertDailyBars([
      { symbol: 'GC=F', date: '2026-09-28', close: 4200.5, source: 'yahoo' },
      { symbol: 'GC=F', date: '2026-09-29', close: 4210, source: 'yahoo' },
      { symbol: 'GLD', date: '2026-09-29', close: 390.1, source: 'yahoo' },
    ])
    upsertContracts([{ symbol: 'GCZ26', root: 'GC', year: 2026, month: 12, lastTrade: '2026-12-29', firstNotice: '2026-11-30' }])
    upsertContractBars([{ symbol: 'GCZ26', date: '2026-09-29', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, openInterest: 5, source: 'databento' }])
    db.exec(`CREATE TABLE ai_reports (id INTEGER PRIMARY KEY, created_at TEXT, body TEXT)`)
    db.prepare('INSERT INTO ai_reports (created_at, body) VALUES (?, ?), (?, ?)').run('2026-09-29 10:00:00', 'Gold, "firm"\nstill', '2026-09-30 23:59:00', 'late')
  })

  it('rejects datasets outside the whitelist', () => {
    expect(() => buildExportQuery('sqlite_master', {})).toThrow(ExportNotFoundError)
    expect(() => buildExportQuery('settings', {})).toThrow(ExportNotFoundError)
    expect(() => buildExportQuery('prices_daily; DROP TABLE x', {})).toThrow(ExportNotFoundError)
  })

  it('returns a clean not-found for whitelisted tables that do not exist yet', () => {
    expect(() => buildExportQuery('transactions', {})).toThrow(/does not exist yet/)
  })

  it('filters prices_daily by symbol, source and inclusive date range with bound parameters', () => {
    const q = buildExportQuery('prices_daily', { symbol: 'GC=F', source: 'yahoo', from: '2026-09-29', to: '2026-09-29' })
    expect(q.sql).not.toContain('GC=F')
    expect(q.params.slice(0, 2)).toEqual(['GC=F', 'yahoo'])
  })

  it('treats a root symbol as a root filter for contract_bars', () => {
    expect(buildExportQuery('contract_bars', { symbol: 'GC' }).sql).toContain('c.root = ?')
    expect(buildExportQuery('contract_bars', { symbol: 'GCZ26' }).sql).toContain('b.symbol = ?')
  })

  it('streams CSV with a download filename', async () => {
    const cap = captureResponse()
    const n = await streamExport(cap.res, buildExportQuery('prices_daily', { symbol: 'GC=F' }), 'csv', exportFilename('prices_daily', { symbol: 'GC=F' }, 'csv'))
    await cap.done
    expect(n).toBe(2)
    expect(cap.headers['content-disposition']).toBe('attachment; filename="prices_daily_GC-F.csv"')
    expect(cap.body()).toBe(
      'symbol,date,open,high,low,close,volume,open_interest,source\r\nGC=F,2026-09-28,,,,4200.5,,,yahoo\r\nGC=F,2026-09-29,,,,4210,,,yahoo\r\n',
    )
  })

  it('exports a generic table verbatim with CSV escaping and timestamp-inclusive date filters', async () => {
    const cap = captureResponse()
    await streamExport(cap.res, buildExportQuery('ai_reports', { to: '2026-09-30' }), 'csv', 'x.csv')
    await cap.done
    expect(cap.body()).toBe('id,created_at,body\r\n1,2026-09-29 10:00:00,"Gold, ""firm""\nstill"\r\n2,2026-09-30 23:59:00,late\r\n')
  })

  it('streams valid JSON arrays (including empty)', async () => {
    const cap = captureResponse()
    await streamExport(cap.res, buildExportQuery('contract_bars', { symbol: 'GC' }), 'json', 'x.json')
    await cap.done
    expect(JSON.parse(cap.body())).toEqual([
      { symbol: 'GCZ26', root: 'GC', date: '2026-09-29', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, open_interest: 5, source: 'databento' },
    ])
    const empty = captureResponse()
    await streamExport(empty.res, buildExportQuery('prices_daily', { symbol: 'NOPE' }), 'json', 'x.json')
    await empty.done
    expect(JSON.parse(empty.body())).toEqual([])
  })
})
