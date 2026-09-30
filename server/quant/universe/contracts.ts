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
// safe). Weekends are handled; exchange HOLIDAYS are NOT — these are documented
// APPROXIMATIONS for display, surfaced with a caveat, not a trading calendar.

/** Day of week (0=Sun..6=Sat) for Y,M,D — deterministic, no "now". */
function dow(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function isoOf(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** The nth (1-based) business day (Mon–Fri) of a month. */
function nthBusinessDay(y: number, m: number, n: number): string {
  let count = 0;
  const dim = daysInMonth(y, m);
  for (let d = 1; d <= dim; d++) {
    const w = dow(y, m, d);
    if (w !== 0 && w !== 6) {
      count++;
      if (count === n) return isoOf(y, m, d);
    }
  }
  return isoOf(y, m, dim);
}
/** The last business day (Mon–Fri) of a month. */
function lastBusinessDay(y: number, m: number): string {
  const dim = daysInMonth(y, m);
  for (let d = dim; d >= 1; d--) {
    const w = dow(y, m, d);
    if (w !== 0 && w !== 6) return isoOf(y, m, d);
  }
  return isoOf(y, m, dim);
}
/** The last occurrence of `weekday` (0=Sun..6=Sat) in a month, e.g. last Thursday. */
function lastWeekdayOfMonth(y: number, m: number, weekday: number): string {
  const dim = daysInMonth(y, m);
  for (let d = dim; d >= 1; d--) {
    if (dow(y, m, d) === weekday) return isoOf(y, m, d);
  }
  return isoOf(y, m, dim);
}
/** Business day on or before day `d` of a month (steps back over weekends; into
 *  the prior month if the whole leading span is a weekend — unreachable for the
 *  d=14 grain caller, which always has ≥10 weekdays before it). */
function businessDayOnOrBefore(y: number, m: number, d: number): string {
  let dd = Math.min(d, daysInMonth(y, m));
  while (dd >= 1) {
    const w = dow(y, m, dd);
    if (w !== 0 && w !== 6) return isoOf(y, m, dd);
    dd--;
  }
  return lastBusinessDay(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1);
}

export interface ContractExpiry {
  lastTrade: string | null; // YYYY-MM-DD (final trading day)
  firstNotice: string | null; // YYYY-MM-DD, or null for cash-settled contracts
  cashSettled: boolean;
  note: string; // documents the rule + holiday caveat (surface in the UI)
}

/** n-th business day counting from the END of the month (n=1 → last business day). */
function nthLastBusinessDay(y: number, m: number, n: number): string {
  let d = daysInMonth(y, m);
  let count = 0;
  for (;;) {
    const w = dow(y, m, d);
    if (w !== 0 && w !== 6) {
      count++;
      if (count === n) return isoOf(y, m, d);
    }
    d--;
    if (d < 1) throw new Error(`month ${y}-${m} has fewer than ${n} business days`);
  }
}

/** First business day of a month. */
function firstBusinessDay(y: number, m: number): string {
  for (let d = 1; d <= 7; d++) {
    const w = dow(y, m, d);
    if (w !== 0 && w !== 6) return isoOf(y, m, d);
  }
  throw new Error(`no business day found in ${y}-${m}`);
}

/** Step back `n` business days from an ISO date (weekends skipped). */
function businessDaysBefore(iso: string, n: number): string {
  let [y, m, d] = iso.split("-").map(Number);
  let left = n;
  while (left > 0) {
    d--;
    if (d < 1) {
      m--;
      if (m < 1) { m = 12; y--; }
      d = daysInMonth(y, m);
    }
    const w = dow(y, m, d);
    if (w !== 0 && w !== 6) left--;
  }
  return isoOf(y, m, d);
}

/** Step forward `n` business days from an ISO date (weekends skipped). */
function businessDaysAfter(iso: string, n: number): string {
  let [y, m, d] = iso.split("-").map(Number);
  let left = n;
  while (left > 0) {
    d++;
    if (d > daysInMonth(y, m)) {
      d = 1;
      m++;
      if (m > 12) { m = 1; y++; }
    }
    const w = dow(y, m, d);
    if (w !== 0 && w !== 6) left--;
  }
  return isoOf(y, m, d);
}

const HOLIDAY_CAVEAT = "Approx: weekends handled, exchange holidays NOT — confirm with CME before trading.";
const ICE_CAVEAT = "ICE rule, approximate: weekends handled, exchange holidays NOT — confirm with ICE before trading.";

/**
 * Documented CME/CBOT last-trade & first-notice rules for the products we cover.
 * Livestock (LE/HE/GF) are CASH-SETTLED → no first-notice/delivery. Grains &
 * oilseeds (ZC/ZW/ZS/ZM) are PHYSICALLY DELIVERED → last trade is the business
 * day before the 15th and first notice is the last business day of the prior
 * month. Returns null for unknown products. PURE.
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
    // ── Metals (COMEX/NYMEX): physical; trading ends the 3rd-last business day
    //    of the delivery month; notices begin at the prior month's end. ──
    case "GC":
    case "SI":
    case "MGC":
    case "SIL":
    case "HG":
    case "PL": {
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
    //    LAST FRIDAY of the contract month. ──
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
        lastTrade: businessDaysBefore(lastBusinessDay(year, month1to12), 17),
        firstNotice: businessDaysBefore(firstBusinessDay(year, month1to12), 5),
        cashSettled: false,
        note: `Physically delivered; last trade ≈ 17 business days before month-end; first notice ≈ 5 business days before the first delivery day. ${ICE_CAVEAT}`,
      };
    case "CC":
      return {
        lastTrade: businessDaysBefore(lastBusinessDay(year, month1to12), 11),
        firstNotice: businessDaysBefore(firstBusinessDay(year, month1to12), 10),
        cashSettled: false,
        note: `Physically delivered; last trade = 11 business days before the last business day; first notice = 10 business days before the first business day. ${ICE_CAVEAT}`,
      };
    case "KC":
      return {
        lastTrade: businessDaysBefore(lastBusinessDay(year, month1to12), 8),
        firstNotice: businessDaysBefore(firstBusinessDay(year, month1to12), 7),
        cashSettled: false,
        note: `Physically delivered; last trade = 8 business days before the last business day; first notice = 7 business days before the first business day. ${ICE_CAVEAT}`,
      };
    case "SB": {
      const prevM = month1to12 === 1 ? 12 : month1to12 - 1;
      const prevY = month1to12 === 1 ? year - 1 : year;
      const lastTrade = lastBusinessDay(prevY, prevM);
      return {
        lastTrade,
        firstNotice: businessDaysAfter(lastTrade, 1),
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
