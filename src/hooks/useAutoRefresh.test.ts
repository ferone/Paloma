import { afterEach, describe, expect, it } from 'vitest'
import { UNIVERSE } from '@shared/universe'
import { REFRESH_CLOSED_MS, REFRESH_OPEN_MS, assetSession, combinedSession, isGlobexOpen, isSessionOpen, refreshInterval, sessionOfSymbol } from './useAutoRefresh'

// 2026-10-03 is a Saturday; 2026-09-30 a Wednesday. Times are UTC (ET = UTC-4 in October).
const SAT_NOON = new Date('2026-10-03T16:00:00Z')
const WED_NOON = new Date('2026-09-30T16:00:00Z')
const WED_BREAK = new Date('2026-09-30T21:30:00Z') // 17:30 ET, the daily Globex break
const SUN_EVENING = new Date('2026-10-04T22:30:00Z') // 18:30 ET Sunday, Globex reopens at 18:00

describe('trading sessions', () => {
  it('follows Globex hours (weekend closed, daily 17:00–18:00 ET break, Sunday 18:00 open)', () => {
    expect(isGlobexOpen(WED_NOON)).toBe(true)
    expect(isGlobexOpen(WED_BREAK)).toBe(false)
    expect(isGlobexOpen(SAT_NOON)).toBe(false)
    expect(isGlobexOpen(SUN_EVENING)).toBe(true)
  })

  it('treats 24x7 as always open, including weekends and the Globex break', () => {
    for (const t of [SAT_NOON, WED_BREAK, WED_NOON, SUN_EVENING]) expect(isSessionOpen('24x7', t)).toBe(true)
    expect(isSessionOpen('globex', SAT_NOON)).toBe(false)
  })

  it('refreshes fast while open and slowly while closed', () => {
    expect(refreshInterval('24x7', SAT_NOON)).toBe(REFRESH_OPEN_MS)
    expect(refreshInterval('globex', SAT_NOON)).toBe(REFRESH_CLOSED_MS)
    expect(refreshInterval('globex', WED_NOON)).toBe(REFRESH_OPEN_MS)
  })

  it('keeps a mixed group live when any member trades 24x7', () => {
    expect(combinedSession(['globex', '24x7'])).toBe('24x7')
    expect(combinedSession(['globex'])).toBe('globex')
    expect(combinedSession([])).toBe('globex')
  })
})

describe('sessionOfSymbol', () => {
  const saved = { displaySpot: UNIVERSE.silver.displaySpot, session: UNIVERSE.silver.session }
  afterEach(() => {
    UNIVERSE.silver.displaySpot = saved.displaySpot
    UNIVERSE.silver.session = saved.session
  })

  it('uses the asset session for spot and futures, Globex for funds and unknown symbols', () => {
    expect(sessionOfSymbol('GC=F')).toBe('globex')
    expect(sessionOfSymbol('GCZ26.CMX')).toBe('globex')
    expect(sessionOfSymbol('GLD')).toBe('globex')
    expect(sessionOfSymbol('DX-Y.NYB')).toBe('globex')
    expect(assetSession('gold')).toBe('globex')
  })

  it('marks a 24/7 display quote live, and a 24x7 asset spot live, but not its US-listed funds', () => {
    UNIVERSE.silver.displaySpot = 'XAG-USD'
    expect(sessionOfSymbol('XAG-USD')).toBe('24x7')
    expect(sessionOfSymbol('SI=F')).toBe('globex')
    UNIVERSE.silver.session = '24x7'
    expect(sessionOfSymbol('SI=F')).toBe('24x7')
    expect(sessionOfSymbol('SLV')).toBe('globex')
    expect(assetSession('silver')).toBe('24x7')
  })
})
