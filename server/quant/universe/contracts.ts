/**
 * Futures contract-month symbology. CME month codes F..Z map to Jan..Dec.
 * Databento GLBX `raw_symbol`s use a single-digit year (e.g. "HEK5" = Lean Hogs
 * May 2025), so a symbol string RECYCLES every 10 years ("LEM6" = Jun-2016 AND
 * Jun-2026).
 *
 * DECADE-SAFETY INVARIANT (do NOT switch to a 2-digit year — CME's raw symbols
 * are 1-digit and a 2-digit query would not match): the decade is disambiguated
 * by the query's date range. Every specific-contract pull therefore uses the
 * tight `contractPullWindow` below (a ~10-month slice, far narrower than the
 * 10-year recycle period), and the fetch path additionally enforces it at
 * runtime via `assertSingleContract` in `lib/data/databento.ts` (a window that
 * returns >1 `instrument_id` straddled two decades → that job is skipped). PURE.
 */
import { addCalendarDays, dayOfWeek, isBusinessDay, isWeekend } from "../../../shared/calendar/cme.js";

export const MONTH_CODES = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"] as const;

export function monthCode(month1to12: number): string {
  if (month1to12 < 1 || month1to12 > 12) throw new Error(`bad month ${month1to12}`);
  return MONTH_CODES[month1to12 - 1];
}

export function codeToMonth(code: string): number {
  const i = MONTH_CODES.indexOf(code.toUpperCase() as (typeof MONTH_CODES)[number]);
  if (i < 0) throw new Error(`bad month code ${code}`);
  return i + 1;
}

/** Build a Databento raw_symbol, e.g. contractSymbol("HE", 5, 2025) → "HEK5". */
export function contractSymbol(root: string, month1to12: number, year: number, yearDigits = 1): string {
  const y = year % 10 ** yearDigits;
  return `${root}${monthCode(month1to12)}${String(y).padStart(yearDigits, "0")}`;
}

/**
 * Expand a 1-digit-year raw_symbol (e.g. "HEN6") into the 2-digit form the
 * per-contract pages use (e.g. "HEN26"), resolving the decade from a reference
 * date (the date the leg was resolved at). The contract is within ~2 years of the
 * reference, so we pick the year whose last digit matches and is closest to it.
 * Already-2-digit symbols pass through. PURE — for building `/c/<symbol>` links.
 */
export function rawToContractSymbol(rawSymbol: string, refDate: string): string {
  const m = rawSymbol.match(/^([A-Z]+)([FGHJKMNQUVXZ])(\d{1,2})$/);
  if (!m) return rawSymbol;
  const [, root, code, digits] = m;
  if (digits.length >= 2) return rawSymbol; // already /c/-compatible
  const refYear = Number(refDate.slice(0, 4));
  const d = Number(digits);
  let best = refYear;
  let bestDist = Infinity;
  for (let y = refYear - 2; y <= refYear + 3; y++) {
    if (y % 10 === d) {
      const dist = Math.abs(y - refYear);
      if (dist < bestDist) {
        bestDist = dist;
        best = y;
      }
    }
  }
  return `${root}${code}${String(best % 100).padStart(2, "0")}`;
}

export interface ContractRef {
  symbol: string;
  root: string;
  month: number;
  year: number;
}

/** Add `n` months to a YYYY-MM-DD date (window-boundary arithmetic). PURE. */
function addMonthsIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * The tight pull window for ONE specific futures contract month: ~`monthsBefore`
 * (default 9) before the contract month through ~1 month after (≈ expiry),
 * clamped to the available data range (`overallStart`..`dataEnd`; `end`
 * exclusive). This is the DECADE-SAFETY mechanism for the recycled 1-digit CME
 * symbol — the window is far narrower than the 10-year recycle period, so a
 * symbol like "LEM6" resolves to exactly one contract (2026, not also 2016).
 * `assertSingleContract` then guards the residual at fetch time. PURE.
 */
export function contractPullWindow(
  month1to12: number,
  year: number,
  overallStart: string,
  dataEnd: string,
  monthsBefore = 9,
): { start: string; end: string } {
  const anchor = `${year}-${String(month1to12).padStart(2, "0")}-01`;
  let start = addMonthsIso(anchor, -monthsBefore);
  if (start < overallStart) start = overallStart;
  const end = addMonthsIso(anchor, 1);
  return { start, end: end < dataEnd ? end : dataEnd };
}

// ── Contract expiry / first-notice (documented CME rules) ───────────────────
// Pure calendar arithmetic (deterministic UTC, never reads "now" → look-ahead
// safe). CME Group products (CME, CBOT, NYMEX, COMEX, incl. CME crypto) count
// business days on the rule-based CME holiday calendar (shared/calendar/cme.ts):
// weekends AND exchange holidays are skipped, and a rule that lands on a
// specific weekday (e.g. "last Friday") steps back to the preceding business
// day when that weekday is a holiday. ICE softs use weekends only (the ICE
// holiday calendar is not modelled). Ad-hoc closures are not modelled either.

/** A business-day predicate on ISO dates (the exchange calendar). */
type Calendar = (iso: string) => boolean;

/** Mon–Fri only (ICE products: their holiday calendar is not modelled). */
const weekdaysOnly: Calendar = (iso) => !isWeekend(iso);
/** CME Group: Mon–Fri minus CME holidays. */
const cme: Calendar = isBusinessDay;

function isoOf(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** Step one calendar day at a time from `iso` until `cal` accepts the date. */
function rollTo(iso: string, step: 1 | -1, cal: Calendar): string {
  let d = iso;
  while (!cal(d)) d = addCalendarDays(d, step);
  return d;
}
/** Move `n` business days (n ≥ 0) in direction `step` on calendar `cal`. */
function moveBusinessDays(iso: string, n: number, step: 1 | -1, cal: Calendar): string {
  let d = iso;
  let left = n;
  while (left > 0) {
    d = addCalendarDays(d, step);
    if (cal(d)) left--;
  }
  return d;
}
/** The nth (1-based) business day of a month. */
function nthBusinessDay(y: number, m: number, n: number, cal: Calendar = cme): string {
  let count = 0;
  const dim = daysInMonth(y, m);
  for (let d = 1; d <= dim; d++) {
    if (cal(isoOf(y, m, d))) {
      count++;
      if (count === n) return isoOf(y, m, d);
    }
  }
  return isoOf(y, m, dim);
}
/** n-th business day counting from the END of the month (n=1 → last business day). */
function nthLastBusinessDay(y: number, m: number, n: number, cal: Calendar = cme): string {
  let count = 0;
  for (let d = daysInMonth(y, m); d >= 1; d--) {
    if (cal(isoOf(y, m, d))) {
      count++;
      if (count === n) return isoOf(y, m, d);
    }
  }
  throw new Error(`month ${y}-${m} has fewer than ${n} business days`);
}
/** The last business day of a month. */
function lastBusinessDay(y: number, m: number, cal: Calendar = cme): string {
  return rollTo(isoOf(y, m, daysInMonth(y, m)), -1, cal);
}
/** First business day of a month. */
function firstBusinessDay(y: number, m: number, cal: Calendar = cme): string {
  return rollTo(isoOf(y, m, 1), 1, cal);
}
/**
 * The last occurrence of `weekday` (0=Sun..6=Sat) in a month, e.g. last Friday;
 * when that day is an exchange holiday, the preceding business day (CME rule
 * wording: "if that day is not a business day, the business day prior").
 */
function lastWeekdayOfMonth(y: number, m: number, weekday: number, cal: Calendar = cme): string {
  const dim = daysInMonth(y, m);
  for (let d = dim; d >= 1; d--) {
    const iso = isoOf(y, m, d);
    if (dayOfWeek(iso) === weekday) return rollTo(iso, -1, cal);
  }
  return isoOf(y, m, dim);
}
/** Business day on or before day `d` of a month (may step into the prior month). */
function businessDayOnOrBefore(y: number, m: number, d: number, cal: Calendar = cme): string {
  return rollTo(isoOf(y, m, Math.min(d, daysInMonth(y, m))), -1, cal);
}

export interface ContractExpiry {
  lastTrade: string | null; // YYYY-MM-DD (final trading day)
  firstNotice: string | null; // YYYY-MM-DD, or null for cash-settled contracts
  cashSettled: boolean;
  note: string; // documents the rule + holiday caveat (surface in the UI)
}

/** Step back `n` CME business days from an ISO date (weekends and CME holidays skipped). */
export function businessDaysBefore(iso: string, n: number): string {
  return moveBusinessDays(iso, n, -1, cme);
}

/** Step forward `n` CME business days from an ISO date (weekends and CME holidays skipped). */
export function businessDaysAfter(iso: string, n: number): string {
  return moveBusinessDays(iso, n, 1, cme);
}

const HOLIDAY_CAVEAT = "CME holiday calendar applied (rule-based; ad-hoc closures not modelled) — confirm with CME before trading.";
const ICE_CAVEAT = "ICE rule, approximate: weekends handled, ICE holidays NOT — confirm with ICE before trading.";

/**
 * Documented CME/CBOT last-trade & first-notice rules for the products we cover.
 * Livestock (LE/HE/GF) are CASH-SETTLED → no first-notice/delivery. Grains &
 * oilseeds (ZC/ZW/ZS/ZM) are PHYSICALLY DELIVERED → last trade is the business
 * day before the 15th and first notice is the last business day of the prior
 * month. Returns null for unknown products. PURE.
 *
 * STABLE SIGNATURE `(product, month1to12, year)`: the marketdata domain imports
 * this as its single expiry calendar — do not change it.
 */
export function contractExpiry(product: string, month1to12: number, year: number): ContractExpiry | null {
  switch (product) {
    case "LE":
      return {
        lastTrade: lastBusinessDay(year, month1to12),
        firstNotice: null,
        cashSettled: true,
        note: `Live Cattle is cash-settled; last trade = last business day of the contract month. ${HOLIDAY_CAVEAT}`,
      };
    case "HE":
      return {
        lastTrade: nthBusinessDay(year, month1to12, 10),
        firstNotice: null,
        cashSettled: true,
        note: `Lean Hogs is cash-settled; last trade = 10th business day of the contract month. ${HOLIDAY_CAVEAT}`,
      };
    case "GF":
      return {
        lastTrade: lastWeekdayOfMonth(year, month1to12, 4),
        firstNotice: null,
        cashSettled: true,
        note: `Feeder Cattle is cash-settled; last trade ≈ last Thursday of the contract month (Nov can differ). ${HOLIDAY_CAVEAT}`,
      };
    case "ZC":
    case "ZW":
    case "ZS":
    case "ZM": {
      const prevM = month1to12 === 1 ? 12 : month1to12 - 1;
      const prevY = month1to12 === 1 ? year - 1 : year;
      return {
        lastTrade: businessDayOnOrBefore(year, month1to12, 14),
        firstNotice: lastBusinessDay(prevY, prevM),
        cashSettled: false,
        note: `Physically delivered; last trade = business day before the 15th; first notice = last business day of the prior month. ${HOLIDAY_CAVEAT}`,
      };
    }
    // ── Metals (COMEX gold/silver/copper incl. micros, NYMEX platinum/palladium): physical;
    //    trading ends the 3rd-last business day of the delivery month; notices
    //    begin at the prior month's end (the same NYMEX rule for PL and PA). ──
    case "GC":
    case "SI":
    case "MGC":
    case "SIL":
    case "HG":
    case "MHG":
    case "PL":
    case "PA": {
      const prevM = month1to12 === 1 ? 12 : month1to12 - 1;
      const prevY = month1to12 === 1 ? year - 1 : year;
      return {
        lastTrade: nthLastBusinessDay(year, month1to12, 3),
        firstNotice: lastBusinessDay(prevY, prevM),
        cashSettled: false,
        note: `Physically delivered; last trade = 3rd-last business day of the delivery month; first notice = last business day of the prior month. ${HOLIDAY_CAVEAT}`,
      };
    }
    // ── WTI: trading ends 3 business days before the 25th CALENDAR day of the
    //    month PRIOR to delivery (25th itself rolled back to a business day). ──
    case "CL": {
      const prevM = month1to12 === 1 ? 12 : month1to12 - 1;
      const prevY = month1to12 === 1 ? year - 1 : year;
      const ref = businessDayOnOrBefore(prevY, prevM, 25);
      return {
        lastTrade: businessDaysBefore(ref, 3),
        firstNotice: null,
        cashSettled: false,
        note: `Physically delivered (Cushing); last trade = 3 business days before the 25th of the month prior to delivery; delivery notices follow expiry. ${HOLIDAY_CAVEAT}`,
      };
    }
    // ── Henry Hub: trading ends 3 business days before the 1st of delivery. ──
    case "NG":
      return {
        lastTrade: businessDaysBefore(isoOf(year, month1to12, 1), 3),
        firstNotice: null,
        cashSettled: false,
        note: `Physically delivered (Henry Hub); last trade = 3 business days before the first day of the delivery month. ${HOLIDAY_CAVEAT}`,
      };
    // ── Products: trading ends the last business day of the PRIOR month. ──
    case "HO":
    case "RB": {
      const prevM = month1to12 === 1 ? 12 : month1to12 - 1;
      const prevY = month1to12 === 1 ? year - 1 : year;
      return {
        lastTrade: lastBusinessDay(prevY, prevM),
        firstNotice: null,
        cashSettled: false,
        note: `Physically delivered (NY Harbor); last trade = last business day of the month prior to delivery. ${HOLIDAY_CAVEAT}`,
      };
    }
    // ── CME crypto: cash-settled to the 4 p.m. London reference rate on the
    //    LAST FRIDAY of the contract month; if that is not a business day, the
    //    business day before (e.g. Dec 2026: Fri 25th is Christmas → Thu 24th).
    //    CME also requires a LONDON business day; UK-only holidays are not
    //    modelled (Good Friday, the common case, is a CME holiday too). ──
    case "BTC":
    case "MBT":
    case "ETH":
      return {
        lastTrade: lastWeekdayOfMonth(year, month1to12, 5),
        firstNotice: null,
        cashSettled: true,
        note: `Cash-settled (CME CF reference rate, 4 p.m. London); last trade = last Friday of the contract month. ${HOLIDAY_CAVEAT}`,
      };
    // ── ICE softs (approximate rules; ICE holiday calendar not modeled) ──
    case "CT":
      return {
        lastTrade: moveBusinessDays(lastBusinessDay(year, month1to12, weekdaysOnly), 17, -1, weekdaysOnly),
        firstNotice: moveBusinessDays(firstBusinessDay(year, month1to12, weekdaysOnly), 5, -1, weekdaysOnly),
        cashSettled: false,
        note: `Physically delivered; last trade ≈ 17 business days before month-end; first notice ≈ 5 business days before the first delivery day. ${ICE_CAVEAT}`,
      };
    case "CC":
      return {
        lastTrade: moveBusinessDays(lastBusinessDay(year, month1to12, weekdaysOnly), 11, -1, weekdaysOnly),
        firstNotice: moveBusinessDays(firstBusinessDay(year, month1to12, weekdaysOnly), 10, -1, weekdaysOnly),
        cashSettled: false,
        note: `Physically delivered; last trade = 11 business days before the last business day; first notice = 10 business days before the first business day. ${ICE_CAVEAT}`,
      };
    case "KC":
      return {
        lastTrade: moveBusinessDays(lastBusinessDay(year, month1to12, weekdaysOnly), 8, -1, weekdaysOnly),
        firstNotice: moveBusinessDays(firstBusinessDay(year, month1to12, weekdaysOnly), 7, -1, weekdaysOnly),
        cashSettled: false,
        note: `Physically delivered; last trade = 8 business days before the last business day; first notice = 7 business days before the first business day. ${ICE_CAVEAT}`,
      };
    case "SB": {
      const prevM = month1to12 === 1 ? 12 : month1to12 - 1;
      const prevY = month1to12 === 1 ? year - 1 : year;
      const lastTrade = lastBusinessDay(prevY, prevM, weekdaysOnly);
      return {
        lastTrade,
        firstNotice: moveBusinessDays(lastTrade, 1, 1, weekdaysOnly),
        cashSettled: false,
        note: `Physically delivered; last trade = last business day of the month preceding delivery; first notice = the following business day. ${ICE_CAVEAT}`,
      };
    }
    default:
      return null;
  }
}

/**
 * Databento `raw_symbol` for ONE contract on the product's dataset.
 *  - GLBX → the decade-safe 1-digit CME format (`contractSymbol`, disambiguated
 *    downstream by `contractPullWindow` + `assertSingleContract`).
 *  - IFUS → the ICE raw format is NOT assumed: run `scripts/probe-ice.ts` first
 *    (symbology.resolve reveals the real shape), then implement this branch from
 *    the probe's evidence. Fail-fast beats a silently wrong symbol. PURE.
 */
export function rawSymbolFor(p: { product: string; dataset: string }, month1to12: number, year: number): string {
  if (p.dataset === "GLBX.MDP3") return contractSymbol(p.product, month1to12, year, 1);
  if (p.dataset === "IFUS.IMPACT") {
    // VERIFIED live 2026-07-02 (symbology.resolve round-trips for CT/CC/KC/SB):
    // ICE iMpact raw symbol = root space-padded to 4 chars + "FM" + month code +
    // the 2-digit year zero-padded to 4 + "!" (the "!" marks the OUTRIGHT leg;
    // spread instruments are "A-B" pairs without it). e.g. "CT  FMU0026!".
    return `${p.product.padEnd(4)}FM${monthCode(month1to12)}${String(year % 100).padStart(4, "0")}!`;
  }
  throw new Error(
    `rawSymbolFor: the ${p.dataset} raw_symbol format is unverified for ${p.product} — probe symbology.resolve first (see scripts/probe-ice.ts)`,
  );
}

/** Expand a root × months × years grid into concrete contract refs. */
export function expandContracts(
  root: string,
  months: number[],
  years: number[],
  yearDigits = 1,
): ContractRef[] {
  const out: ContractRef[] = [];
  for (const year of years) {
    for (const month of months) {
      out.push({ symbol: contractSymbol(root, month, year, yearDigits), root, month, year });
    }
  }
  return out;
}
