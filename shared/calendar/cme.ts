// CME Group (Globex / NYMEX / COMEX / CBOT) trading-holiday calendar, rule-based.
//
// PURE and deterministic: dates are ISO `YYYY-MM-DD` strings handled in UTC,
// nothing reads "now", so it is safe inside look-ahead-sensitive engine code.
//
// WHAT COUNTS AS A HOLIDAY HERE
//   A day with no regular settlement for CME's US futures, i.e. a day that is
//   not a "business day" when an exchange rule counts business days (e.g.
//   "trading terminates on the third last business day of the delivery month").
//   That is the US exchange holiday set:
//     New Year's Day, Martin Luther King Jr. Day (3rd Mon Jan), Presidents Day
//     (3rd Mon Feb), Good Friday, Memorial Day (last Mon May), Juneteenth
//     (Jun 19, from 2022), Independence Day, Labor Day (1st Mon Sep),
//     Thanksgiving (4th Thu Nov), Christmas.
//
// CME PRACTICE AND KNOWN EXCEPTIONS (honest notes, not modelled)
//   * Only New Year's Day, Good Friday and Christmas are full closures. On the
//     other holidays Globex usually runs an abbreviated session (early halt),
//     but no settlement is published for the holiday and those trades belong to
//     the next trade date, so the day is still not a business day for expiry
//     counting. That is the property this module models.
//   * Observed dates: a holiday on Sunday is observed Monday; one on Saturday is
//     observed the preceding Friday. EXCEPTION: when Jan 1 falls on a Saturday,
//     CME (like NYSE) does NOT close on Friday Dec 31 (e.g. 2021-12-31 and
//     2010-12-31 were trading days), so New Year's Day has no Friday observance.
//   * Good Friday: CME metals and energy are closed. In some years (e.g. 2021,
//     2023) CME ran a shortened session for interest-rate and equity
//     products because US payrolls were released that day; metals/energy and
//     crypto settlement were unaffected, so Good Friday stays a holiday here.
//   * Juneteenth became a CME holiday in 2022 (first observed 2022-06-20).
//   * MLK Day is applied from 1998 (when US exchanges began observing it).
//   * Ad-hoc closures are NOT modelled: 2001-09-11..14, national days of
//     mourning (2004-06-11 Reagan, 2007-01-02 Ford, 2018-12-05 Bush,
//     2025-01-09 Carter, mostly early closes for CME rather than full closures),
//     and weather closures (2012-10-29/30). Dates that depend on them are off by
//     at most one business day.

/** Parse an ISO date into UTC year/month/day. */
function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return [y, m, d]
}

function isoOf(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d))
}

/** Shift an ISO date by `n` calendar days. */
export function addCalendarDays(iso: string, n: number): string {
  const [y, m, d] = parts(iso)
  return utc(y, m, d + n).toISOString().slice(0, 10)
}

/** Day of week, 0 = Sunday .. 6 = Saturday. */
export function dayOfWeek(iso: string): number {
  const [y, m, d] = parts(iso)
  return utc(y, m, d).getUTCDay()
}

export function isWeekend(iso: string): boolean {
  const w = dayOfWeek(iso)
  return w === 0 || w === 6
}

/** n-th (1-based) occurrence of `weekday` in a month. */
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  const first = utc(y, m, 1).getUTCDay()
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7
  return isoOf(y, m, day)
}

/** Last occurrence of `weekday` in a month. */
function lastWeekday(y: number, m: number, weekday: number): string {
  const dim = utc(y, m + 1, 0).getUTCDate()
  const lastDow = utc(y, m, dim).getUTCDay()
  return isoOf(y, m, dim - ((lastDow - weekday + 7) % 7))
}

/** Easter Sunday (Gregorian), anonymous computus (Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return isoOf(year, month, day)
}

/** Fixed-date holiday moved to its observed weekday (Sat → Fri, Sun → Mon). */
function observed(y: number, m: number, d: number, allowFriday = true): string | null {
  const iso = isoOf(y, m, d)
  const w = dayOfWeek(iso)
  if (w === 6) return allowFriday ? addCalendarDays(iso, -1) : null
  if (w === 0) return addCalendarDays(iso, 1)
  return iso
}

export interface ExchangeHoliday {
  date: string
  name: string
}

const cache = new Map<number, ExchangeHoliday[]>()

/** The CME holiday dates (observed) that fall in calendar year `year`, sorted. */
export function cmeHolidays(year: number): ExchangeHoliday[] {
  const hit = cache.get(year)
  if (hit) return hit
  const out: ExchangeHoliday[] = []
  const push = (date: string | null, name: string) => {
    if (date && date.startsWith(`${year}-`)) out.push({ date, name })
  }
  // New Year's Day: Sunday → Monday; Saturday → no observance (see header).
  push(observed(year, 1, 1, false), "New Year's Day")
  if (year >= 1998) push(nthWeekday(year, 1, 1, 3), 'Martin Luther King Jr. Day')
  push(nthWeekday(year, 2, 1, 3), "Presidents' Day")
  push(addCalendarDays(easterSunday(year), -2), 'Good Friday')
  push(lastWeekday(year, 5, 1), 'Memorial Day')
  if (year >= 2022) push(observed(year, 6, 19), 'Juneteenth')
  push(observed(year, 7, 4), 'Independence Day')
  push(nthWeekday(year, 9, 1, 1), 'Labor Day')
  push(nthWeekday(year, 11, 4, 4), 'Thanksgiving Day')
  push(observed(year, 12, 25), 'Christmas Day')
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  cache.set(year, out)
  return out
}

/** True when `iso` is a CME exchange holiday (observed date). Weekends are not holidays. */
export function isExchangeHoliday(iso: string): boolean {
  const date = iso.slice(0, 10)
  return cmeHolidays(Number(date.slice(0, 4))).some((h) => h.date === date)
}

/** Name of the holiday on `iso`, or null. */
export function exchangeHolidayName(iso: string): string | null {
  const date = iso.slice(0, 10)
  return cmeHolidays(Number(date.slice(0, 4))).find((h) => h.date === date)?.name ?? null
}

/** Mon–Fri and not a CME holiday. */
export function isBusinessDay(iso: string): boolean {
  return !isWeekend(iso) && !isExchangeHoliday(iso)
}

/**
 * Move `n` business days from `iso` (negative = backwards). `n = 0` returns
 * `iso` unchanged even when it is not a business day.
 */
export function addBusinessDays(iso: string, n: number): string {
  let d = iso.slice(0, 10)
  const step = n < 0 ? -1 : 1
  let left = Math.abs(n)
  while (left > 0) {
    d = addCalendarDays(d, step)
    if (isBusinessDay(d)) left--
  }
  return d
}

/** The business day strictly before `iso`. */
export function previousBusinessDay(iso: string): string {
  return addBusinessDays(iso, -1)
}

/** The business day strictly after `iso`. */
export function nextBusinessDay(iso: string): string {
  return addBusinessDays(iso, 1)
}

/** `iso` itself when it is a business day, else the previous business day. */
export function businessDayOnOrBefore(iso: string): string {
  return isBusinessDay(iso) ? iso.slice(0, 10) : previousBusinessDay(iso)
}

/** `iso` itself when it is a business day, else the next business day. */
export function businessDayOnOrAfter(iso: string): string {
  return isBusinessDay(iso) ? iso.slice(0, 10) : nextBusinessDay(iso)
}
