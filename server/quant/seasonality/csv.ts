import type { SeriesPoint } from "../types/index.js";

/**
 * Parse a user-pasted CSV of either `date,spread` or `date,leg1,leg2`
 * (spread = leg1 − leg2) into ascending `SeriesPoint[]`. A header row is
 * auto-skipped (first non-empty cell not an ISO date); blank lines are ignored;
 * malformed rows are collected as capped, human-readable errors.
 *
 * PURE — this runs CLIENT-SIDE in /import, so it never touches IO and nothing it
 * produces is persisted. No fabrication: only rows that genuinely parse become
 * points (a bad row is reported, never silently zero-filled).
 */
export interface CsvParseResult {
  points: SeriesPoint[];
  rows: number; // valid data rows
  errors: string[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function parseSpreadCsv(text: string, maxErrors = 20): CsvParseResult {
  const points: SeriesPoint[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  let sawData = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(/[,;\t]/).map((c) => c.trim());
    const date = cells[0];

    if (!ISO.test(date)) {
      if (!sawData && points.length === 0) continue; // treat the first non-date row as a header
      if (errors.length < maxErrors) errors.push(`line ${i + 1}: invalid date "${cells[0]}"`);
      continue;
    }

    let spread: number;
    if (cells.length >= 3 && cells[2] !== "") {
      const a = Number(cells[1]);
      const b = Number(cells[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        if (errors.length < maxErrors) errors.push(`line ${i + 1}: non-numeric legs`);
        continue;
      }
      spread = a - b;
    } else {
      const s = Number(cells[1]);
      if (!Number.isFinite(s)) {
        if (errors.length < maxErrors) errors.push(`line ${i + 1}: non-numeric spread`);
        continue;
      }
      spread = s;
    }
    sawData = true;
    points.push({ date, value: Number(spread.toFixed(6)) });
  }

  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { points, rows: points.length, errors };
}
