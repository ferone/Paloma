import { describe, expect, it } from 'vitest'
import type { QuantOpportunityLite } from '../../shared/artifacts.js'
import { isActionable, rankForBrief } from './context.js'

const o = (id: string, verdict: string, qtRank: number, oosStatus = 'failed'): QuantOpportunityLite =>
  ({ id, asset: 'silver', label: id, side: 'long', tier: 'MODERATE', verdict, qtRank, z: null, oosStatus }) as QuantOpportunityLite

describe('trade brief focus', () => {
  it('puts what the engine would trade first, not merely the top rank', () => {
    // The real case: Jul–Dec ranks highest but is AVOID; Mar–May is the actionable BUY.
    const ranked = rankForBrief([o('SI.seas.N-Z', 'AVOID', 75, 'passed'), o('SI.seas.H-K', 'BUY', 69, 'passed'), o('SI.seas.H-U', 'AVOID', 50)])
    expect(ranked.map((x) => x.id)).toEqual(['SI.seas.H-K', 'SI.seas.N-Z', 'SI.seas.H-U'])
  })

  it('falls back to OOS-passed, then rank, when nothing is actionable', () => {
    const ranked = rankForBrief([o('a', 'AVOID', 80), o('b', 'AVOID', 60, 'passed'), o('c', 'STAND_ASIDE', 70)])
    expect(ranked.map((x) => x.id)).toEqual(['b', 'a', 'c'])
    expect(isActionable(o('s', 'SELL', 1))).toBe(true)
  })
})
