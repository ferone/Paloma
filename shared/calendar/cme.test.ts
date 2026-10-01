import { describe, expect, it } from 'vitest'
import {
  addBusinessDays,
  businessDayOnOrBefore,
  cmeHolidays,
  easterSunday,
  exchangeHolidayName,
  isBusinessDay,
  isExchangeHoliday,
  nextBusinessDay,
  previousBusinessDay,
} from './cme.js'

describe('CME holiday calendar', () => {
  it('computes Easter (Gregorian computus) and Good Friday', () => {
    expect(easterSunday(2024)).toBe('2024-03-31')
    expect(easterSunday(2026)).toBe('2026-04-05')
    expect(easterSunday(2027)).toBe('2027-03-28')
    expect(isExchangeHoliday('2026-04-03')).toBe(true)
    expect(exchangeHolidayName('2026-04-03')).toBe('Good Friday')
  })

  it('lists the 2026 holidays with their observed dates', () => {
    expect(cmeHolidays(2026).map((h) => h.date)).toEqual([
      '2026-01-01', // New Year's Day (Thu)
      '2026-01-19', // MLK (3rd Mon)
      '2026-02-16', // Presidents (3rd Mon)
      '2026-04-03', // Good Friday
      '2026-05-25', // Memorial (last Mon)
      '2026-06-19', // Juneteenth (Fri)
      '2026-07-03', // Independence Day: Jul 4 is a Saturday → observed Fri
      '2026-09-07', // Labor Day
      '2026-11-26', // Thanksgiving
      '2026-12-25', // Christmas (Fri)
    ])
  })

  it('observes Juneteenth 2027 (a Saturday) on Friday 18 June, and not at all before 2022', () => {
    expect(isExchangeHoliday('2027-06-18')).toBe(true)
    expect(isExchangeHoliday('2027-06-19')).toBe(false) // the Saturday itself is a weekend, not a holiday
    expect(isBusinessDay('2027-06-18')).toBe(false)
    expect(isExchangeHoliday('2021-06-18')).toBe(false)
    expect(isExchangeHoliday('2022-06-20')).toBe(true) // first observance: Sun 19 → Mon 20
  })

  it('moves Sunday holidays to Monday; a Saturday New Year has no Friday observance', () => {
    expect(isExchangeHoliday('2022-12-26')).toBe(true) // Christmas on Sunday
    expect(isExchangeHoliday('2023-01-02')).toBe(true) // New Year on Sunday
    expect(isExchangeHoliday('2021-12-31')).toBe(false) // Jan 1 2022 was a Saturday: Dec 31 traded
    expect(isBusinessDay('2021-12-31')).toBe(true)
  })

  it('steps over weekends and holidays', () => {
    expect(previousBusinessDay('2026-12-28')).toBe('2026-12-24') // Mon → skips weekend + Christmas
    expect(nextBusinessDay('2026-11-25')).toBe('2026-11-27') // skips Thanksgiving
    expect(addBusinessDays('2026-04-06', -1)).toBe('2026-04-02') // skips Good Friday
    expect(addBusinessDays('2026-04-02', 1)).toBe('2026-04-06')
    expect(addBusinessDays('2026-04-04', 0)).toBe('2026-04-04')
    expect(businessDayOnOrBefore('2026-12-25')).toBe('2026-12-24')
    expect(businessDayOnOrBefore('2026-12-24')).toBe('2026-12-24')
  })
})
