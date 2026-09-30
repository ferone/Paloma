import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  decodeOhlcv,
  decodeOpenInterest,
  decodeSymbology,
  fixedPrice,
  foldWeekendBars,
  nsToDate,
  parseJsonLines,
  type DbnOhlcvRecord,
  type DbnStatRecord,
} from './parse.js'
import { contractExpiry, parseCanonical, parseRawSymbol } from '../contracts.js'

// Fixtures are trimmed REAL GLBX.MDP3 responses (SIL.FUT parent, 2026-09-04 → 09-09,
// encoding=json, map_symbols=true) recorded during development.
const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')
const ohlcv = parseJsonLines<DbnOhlcvRecord>(fixture('sil-ohlcv-1d.jsonl'))
const stats = parseJsonLines<DbnStatRecord>(fixture('sil-statistics.jsonl'))

describe('fixed-point prices and ns timestamps', () => {
  it('scales 1e-9 integers and keeps sub-cent precision', () => {
    expect(fixedPrice('67585000000')).toBe(67.585)
    expect(fixedPrice('-1388000000')).toBe(-1.388)
    expect(fixedPrice('9223372036854775807')).toBeNull()
  })
  it('converts nanosecond epochs beyond Number range to UTC dates', () => {
    expect(nsToDate('1788480000000000000')).toBe('2026-09-04')
    expect(nsToDate('1788482085604447609')).toBe('2026-09-04')
  })
  it('parses JSON lines with CRLF and blank lines', () => {
    expect(parseJsonLines<{ a: number }>('{"a":1}\r\n\r\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }])
  })
})

describe('symbol decade mapping', () => {
  it('maps single-digit years to the decade implied by the record date', () => {
    expect(parseRawSymbol('GCZ6', 'GC', '2026-09-04')?.symbol).toBe('GCZ26')
    expect(parseRawSymbol('GCZ6', 'GC', '2016-03-01')?.symbol).toBe('GCZ16')
    // Long-dated listings roll into the next decade year.
    expect(parseRawSymbol('GCZ1', 'GC', '2026-09-04')).toMatchObject({ symbol: 'GCZ31', year: 2031, month: 12 })
    // A contract in its own delivery month is still the current year.
    expect(parseRawSymbol('GCZ9', 'GC', '2019-12-20')?.symbol).toBe('GCZ19')
    // January contract seen in December of the prior year.
    expect(parseRawSymbol('SIF0', 'SI', '2019-12-02')?.symbol).toBe('SIF20')
  })
  it('rejects spreads, other roots and junk', () => {
    expect(parseRawSymbol('GCZ6-GCG7', 'GC', '2026-09-04')).toBeNull()
    expect(parseRawSymbol('MGCZ6', 'GC', '2026-09-04')).toBeNull()
    expect(parseRawSymbol('GCZ6', 'MGC', '2026-09-04')).toBeNull()
    expect(parseRawSymbol('UD:1V: VT 0904', 'GC', '2026-09-04')).toBeNull()
  })
  it('parses canonical symbols preferring the longest root', () => {
    expect(parseCanonical('MGCZ26', ['GC', 'MGC'])).toMatchObject({ root: 'MGC', month: 12, year: 2026 })
    expect(parseCanonical('SILH27', ['SI', 'SIL'])).toMatchObject({ root: 'SIL', month: 3, year: 2027 })
  })
  it('applies COMEX expiry rules', () => {
    expect(contractExpiry('GC', 12, 2026)).toEqual({ lastTrade: '2026-12-29', firstNotice: '2026-11-30' })
    // Micro silver follows silver; January contract's first notice is in December.
    expect(contractExpiry('SIL', 1, 2027)).toEqual({ lastTrade: '2027-01-27', firstNotice: '2026-12-31' })
  })
})

describe('decodeOhlcv (real SIL.FUT records)', () => {
  const res = decodeOhlcv(ohlcv, 'SIL')
  it('keeps only outrights and counts dropped spreads', () => {
    expect(new Set(res.rows.map((r) => r.contract.symbol))).toEqual(new Set(['SILZ26', 'SILU26']))
    expect(res.skippedSpreads).toBe(8)
    expect(res.unmapped).toEqual([])
  })
  it('decodes a bar exactly', () => {
    const b = res.rows.find((r) => r.contract.symbol === 'SILZ26' && r.date === '2026-09-04')!
    expect(b).toMatchObject({ open: 67.585, high: 67.805, low: 65.33, close: 66.81, volume: 48147, instrumentId: 42002352 })
  })
  it('resolves unmapped records through a symbology map and reports the rest', () => {
    const stripped = ohlcv.map((r) => ({ ...r, symbol: undefined }))
    const partial = decodeOhlcv(stripped, 'SIL', { 42002352: 'SILZ6' })
    expect(partial.rows.every((r) => r.contract.symbol === 'SILZ26')).toBe(true)
    expect(partial.unmapped.sort()).toEqual([42019894, 42033153, 42543828])
  })
  it('folds the Sunday session bar into Monday', () => {
    const folded = foldWeekendBars(res.rows).filter((r) => r.contract.symbol === 'SILZ26')
    expect(folded.map((r) => r.date)).toEqual(['2026-09-04', '2026-09-07', '2026-09-08'])
    const mon = folded[1]
    expect(mon).toMatchObject({ open: 66.8, high: 67.375, low: 66.015, close: 67.195, volume: 31065 + 1134 })
  })
})

describe('decodeOpenInterest (real statistics records)', () => {
  const res = decodeOpenInterest(stats, 'SIL')
  it('keeps stat_type 9 only, keyed by the ts_ref session date, latest publication wins', () => {
    const z = res.rows.filter((r) => r.contract.symbol === 'SILZ26')
    expect(z.map((r) => [r.date, r.openInterest])).toEqual([
      ['2026-09-03', 11444],
      ['2026-09-04', 11670],
      ['2026-09-07', 11670],
    ])
    expect(res.rows.some((r) => r.contract.symbol === 'SILV26' && r.date === '2026-09-03' && r.openInterest === 1700)).toBe(true)
  })
  it('drops spread instruments', () => {
    expect(res.rows.every((r) => !r.contract.symbol.includes('-'))).toBe(true)
  })
})

describe('decodeSymbology', () => {
  it('maps instrument ids to the last non-empty raw symbol', () => {
    expect(decodeSymbology({ result: { '42002352': [{ d0: '2026-09-01', d1: '2026-09-03', s: '' }, { d0: '2026-09-03', d1: '2026-09-09', s: 'SILZ6' }], x: [] } })).toEqual({
      42002352: 'SILZ6',
    })
  })
})
