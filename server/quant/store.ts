import { getDb } from "../db/client.js";
import type { InstrumentDetail, InstrumentListItem, SeasonalityDetail } from "../../shared/quant.js";
import type { QuantResult } from "./run/compute.js";

// Persistence for the quant engine (migration 020). The whole result of one run
// replaces the previous one atomically, so readers never see a half-written run.

export interface QuantRunRow {
  id: number;
  generatedAt: string;
  dataThrough: string | null;
  instruments: number;
  durationMs: number | null;
  summary: unknown;
}

export function saveQuantResult(res: QuantResult, durationMs: number): number {
  const db = getDb();
  let runId = 0;
  db.transaction(() => {
    runId = Number(
      db
        .prepare(
          `INSERT INTO quant_runs (generated_at, data_through, instruments, duration_ms, summary) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          res.generatedAt,
          res.dataThrough,
          res.instruments.length,
          durationMs,
          JSON.stringify({ engine: res.engine, mlCounted: res.mlCounted }),
        ).lastInsertRowid,
    );
    db.prepare(`DELETE FROM quant_instruments`).run();
    const ins = db.prepare(
      `INSERT INTO quant_instruments (id, metal, kind, label, run_id, detail, seasonality) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const seas = new Map(res.seasonality.map((s) => [s.id, s]));
    for (const d of res.instruments) {
      ins.run(d.id, d.metal, d.kind, d.label, runId, JSON.stringify(d), JSON.stringify(seas.get(d.id) ?? null));
    }
    db.prepare(`DELETE FROM quant_reports`).run();
    const rep = db.prepare(`INSERT INTO quant_reports (name, run_id, data) VALUES (?, ?, ?)`);
    rep.run("opportunities", runId, JSON.stringify(res.opportunities));
    rep.run("relative-value", runId, JSON.stringify(res.relativeValue));
    for (const c of res.curves) rep.run(`curve:${c.root}`, runId, JSON.stringify(c));
    for (const b of res.backtests) rep.run(`backtest:${b.metal}:${b.mode}`, runId, JSON.stringify(b));
    for (const g of res.gates) rep.run(`gates:${g.metal}`, runId, JSON.stringify(g));
  })();
  return runId;
}

export function latestRun(): QuantRunRow | null {
  const r = getDb()
    .prepare(
      `SELECT id, generated_at AS generatedAt, data_through AS dataThrough, instruments, duration_ms AS durationMs, summary
       FROM quant_runs ORDER BY id DESC LIMIT 1`,
    )
    .get() as (Omit<QuantRunRow, "summary"> & { summary: string }) | undefined;
  return r ? { ...r, summary: JSON.parse(r.summary) } : null;
}

export function readReport<T>(name: string): T | null {
  const r = getDb().prepare(`SELECT data FROM quant_reports WHERE name = ?`).get(name) as { data: string } | undefined;
  return r ? (JSON.parse(r.data) as T) : null;
}

export function readInstrumentDetail(id: string): InstrumentDetail | null {
  const r = getDb().prepare(`SELECT detail FROM quant_instruments WHERE id = ?`).get(id) as { detail: string } | undefined;
  return r ? (JSON.parse(r.detail) as InstrumentDetail) : null;
}

export function readSeasonalityDetail(id: string): SeasonalityDetail | null {
  const r = getDb().prepare(`SELECT seasonality FROM quant_instruments WHERE id = ?`).get(id) as
    | { seasonality: string }
    | undefined;
  return r ? (JSON.parse(r.seasonality) as SeasonalityDetail | null) : null;
}

export function listInstruments(metal?: string): InstrumentListItem[] {
  return getDb()
    .prepare(
      `SELECT id, label, kind, metal FROM quant_instruments WHERE (? IS NULL OR metal = ? OR id LIKE 'GS.%') ORDER BY id`,
    )
    .all(metal ?? null, metal ?? null) as InstrumentListItem[];
}
