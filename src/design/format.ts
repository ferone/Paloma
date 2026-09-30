// Number/date formatting. Every formatter returns an em dash for missing or
// non-finite input so tables never show "NaN" or "undefined".
const DASH = '—'
const MINUS = '−' // typographic minus aligns with tabular figures

const ok = (n: number | null | undefined): n is number => n != null && Number.isFinite(n)

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (!ok(n)) return DASH
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return n < 0 ? `${MINUS}${s}` : s
}

export function fmtSigned(n: number | null | undefined, digits = 2): string {
  if (!ok(n)) return DASH
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `${n > 0 ? '+' : n < 0 ? MINUS : ''}${s}`
}

export function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (!ok(n)) return DASH
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `${n < 0 ? MINUS : ''}$${s}`
}

export function fmtUsdSigned(n: number | null | undefined, digits = 2): string {
  if (!ok(n)) return DASH
  return `${n > 0 ? '+' : n < 0 ? MINUS : ''}${fmtUsd(Math.abs(n), digits)}`
}

/** Compact currency: $1.2K, $48.6M, $1.1B. */
export function fmtUsdCompact(n: number | null | undefined): string {
  if (!ok(n)) return DASH
  const s = Math.abs(n).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
  return `${n < 0 ? MINUS : ''}$${s}`
}

export function fmtCompact(n: number | null | undefined): string {
  if (!ok(n)) return DASH
  return n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 }).replace('-', MINUS)
}

/** Fraction → percent: 0.0123 → "1.23%". */
export function fmtPct(fraction: number | null | undefined, digits = 2): string {
  if (!ok(fraction)) return DASH
  return `${fmtNum(fraction * 100, digits)}%`
}

/** Fraction → signed percent: 0.0123 → "+1.23%". */
export function fmtPctSigned(fraction: number | null | undefined, digits = 2): string {
  if (!ok(fraction)) return DASH
  return `${fmtSigned(fraction * 100, digits)}%`
}

export function fmtOz(n: number | null | undefined, digits = 3): string {
  if (!ok(n)) return DASH
  return `${fmtNum(n, digits)} oz`
}

// Fixed month names: ICU locale data varies (e.g. 'Sept' vs 'Sep').
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/** "2026-09-30" or ISO → "30 Sep 2026". */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return DASH
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return DASH
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function fmtDateTime(iso: string | number | null | undefined): string {
  if (iso == null) return DASH
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? DASH : dateTimeFmt.format(d)
}

/** "3 min ago", "2 d ago" — for freshness indicators. */
export function fmtAge(iso: string | number | null | undefined, now = Date.now()): string {
  if (iso == null) return DASH
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return DASH
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
