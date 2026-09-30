// RFC 4180 CSV. Fields containing a comma, double quote, CR or LF are wrapped
// in double quotes with embedded quotes doubled; records end in CRLF. null and
// undefined become empty fields. PURE.

export function csvField(v: unknown): string {
  if (v == null) return ''
  let s: string
  if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : ''
  else if (v instanceof Date) s = v.toISOString()
  else if (typeof v === 'object') s = JSON.stringify(v)
  else s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvRow(values: unknown[]): string {
  return values.map(csvField).join(',') + '\r\n'
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  return csvRow(columns) + rows.map((r) => csvRow(columns.map((c) => r[c]))).join('')
}
