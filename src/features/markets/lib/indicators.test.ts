import { describe, expect, it } from 'vitest'
import { aggregateSignals, detectCrosses, ema, last, rsi, signalFromMa, signalFromRsi, sma } from './indicators'

describe('sma', () => {
  it('averages a trailing window and pads the warm-up with null', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })
})

describe('ema', () => {
  it('seeds with the SMA and applies the 2/(n+1) multiplier', () => {
    const out = ema([2, 4, 6, 8], 3)
    expect(out.slice(0, 2)).toEqual([null, null])
    expect(out[2]).toBe(4)
    expect(out[3]).toBeCloseTo(4 + (8 - 4) * 0.5, 12)
  })
})

describe('rsi (Wilder)', () => {
  it('is 100 for a series that only rises and 0 for one that only falls', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i)
    expect(last(rsi(up))).toBe(100)
    expect(last(rsi(up.slice().reverse()))).toBe(0)
  })

  it('is 50 when average gains equal average losses', () => {
    const zig = Array.from({ length: 40 }, (_, i) => (i % 2 ? 101 : 100))
    expect(rsi(zig, 14)[14]).toBeCloseTo(50, 10)
  })

  it('applies Wilder smoothing after the first window', () => {
    // period 2: first avg gain (1+1)/2=1, loss 0 → 100; next change −2:
    // gain = (1·1 + 0)/2 = 0.5, loss = (0·1 + 2)/2 = 1 → RSI = 100 − 100/(1+0.5) = 33.33
    const out = rsi([10, 11, 12, 10], 2)
    expect(out[2]).toBe(100)
    expect(out[3]).toBeCloseTo(100 - 100 / 1.5, 10)
  })

  it('returns nulls until there is enough history', () => {
    expect(rsi([1, 2, 3], 14).every((v) => v === null)).toBe(true)
  })
})

describe('signals', () => {
  it('maps RSI bands', () => {
    expect(signalFromRsi(15)).toBe('strong_buy')
    expect(signalFromRsi(25)).toBe('buy')
    expect(signalFromRsi(50)).toBe('neutral')
    expect(signalFromRsi(75)).toBe('sell')
    expect(signalFromRsi(85)).toBe('strong_sell')
  })

  it('maps price vs moving average', () => {
    expect(signalFromMa(110, 100)).toBe('strong_buy')
    expect(signalFromMa(101, 100)).toBe('buy')
    expect(signalFromMa(99, 100)).toBe('sell')
    expect(signalFromMa(90, 100)).toBe('strong_sell')
  })

  it('averages signal scores', () => {
    expect(aggregateSignals(['strong_buy', 'buy'])).toBe('strong_buy')
    expect(aggregateSignals(['buy', 'sell', 'neutral'])).toBe('neutral')
    expect(aggregateSignals(['sell', 'strong_sell', 'sell'])).toBe('sell')
    expect(aggregateSignals([])).toBe('neutral')
  })
})

describe('detectCrosses', () => {
  it('finds golden and death crosses', () => {
    const short = [1, 2, 3, 2, 1]
    const long = [2, 2, 2, 2, 2]
    expect(detectCrosses(short, long)).toEqual([
      { index: 2, type: 'golden_cross' },
      { index: 4, type: 'death_cross' },
    ])
  })
})
