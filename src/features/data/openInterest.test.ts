import { describe, expect, it } from 'vitest'
import { oiLine, oiMissing } from './openInterest'

describe('open-interest coverage wording', () => {
  it('states "collected since" from the data for a current collection', () => {
    expect(oiLine({ root: 'GC', since: '2026-09-28', last: '2026-09-30', days: 3, current: true, earlierSample: { from: '2010-06-07', to: '2010-07-02' } })).toBe(
      'GC: open interest collected since 28 Sep 2026 (3 days); plus an earlier sample 07 Jun 2010 to 02 Jul 2010',
    )
  })
  it('never implies history for an old, stopped sample', () => {
    expect(oiLine({ root: 'GC', since: '2010-06-07', last: '2010-07-02', days: 20, current: false, earlierSample: null })).toBe(
      'GC: open interest 07 Jun 2010 to 02 Jul 2010 only, not current (20 days)',
    )
  })
  it('lists roots with nothing collected', () => {
    const none = { since: null, last: null, days: 0, current: false, earlierSample: null }
    expect(oiLine({ root: 'SI', ...none })).toBeNull()
    expect(oiMissing([{ root: 'SI', ...none }, { root: 'GC', since: '2026-09-30', last: '2026-09-30', days: 1, current: true, earlierSample: null }])).toEqual(['SI'])
  })
})
