import { Worker } from "node:worker_threads";
import { getDb } from "../db/client.js";
import { listContracts, readRootBars } from "../db/shared-repo.js";
import { readArtifact, readDailyBars, writeArtifact } from "../db/repo.js";
import { ASSETS, UNIVERSE } from "../../shared/universe.js";
import { ARTIFACTS, type MlPredictionsLite, type QuantSnapshotLite } from "../../shared/artifacts.js";
import { allRoots } from "./universe/registry.js";
import { computeQuant, type MarketInput } from "./run/compute.js";
import { saveQuantResult } from "./store.js";

// IO around the pure engine: read the shared market tables + the ML artifact,
// compute, persist (migration 020 tables) and publish the cross-domain
// `quant:snapshot` artifact.

export interface QuantRunSummary {
  ok: boolean;
  message: string;
  runId: number | null;
  dataThrough: string | null;
  instruments: number;
  durationMs: number;
}

/** True when any metal root has at least one stored contract bar. */
export function hasContractData(): boolean {
  const roots = allRoots();
  const row = getDb()
    .prepare(
      `SELECT 1 AS ok FROM contract_bars b JOIN contracts c ON c.symbol = b.symbol
       WHERE c.root IN (${roots.map(() => "?").join(",")}) LIMIT 1`,
    )
    .get(...roots) as { ok: number } | undefined;
  return !!row;
}

export function loadMarketInput(generatedAt: string): MarketInput {
  const roots: MarketInput["roots"] = {};
  for (const root of allRoots()) {
    const bars = readRootBars(root);
    if (bars.length === 0) continue;
    roots[root] = {
      contracts: listContracts(root),
      bars: bars.map((b) => ({ symbol: b.symbol, date: b.date, close: b.close, volume: b.volume, openInterest: b.openInterest })),
    };
  }
  // Spot + cash benchmark for each cash-and-carry basis (Yahoo closes in prices_daily).
  const daily: NonNullable<MarketInput["daily"]> = {};
  for (const asset of ASSETS) {
    const b = UNIVERSE[asset].basis;
    if (!b) continue;
    for (const symbol of [b.spot, b.rate]) {
      daily[symbol] ??= readDailyBars(symbol, { source: "yahoo" }).map((r) => ({ date: r.date, close: r.close }));
    }
  }
  const ml = readArtifact<MlPredictionsLite>(ARTIFACTS.mlPredictions)?.data ?? null;
  return { roots, ml, daily, generatedAt };
}

/** Load → compute → persist → publish. Synchronous (CPU-bound); runs inside the worker. */
export function computeAndPersist(): QuantRunSummary {
  const t0 = Date.now();
  const generatedAt = new Date().toISOString();
  if (!hasContractData()) {
    const lite: QuantSnapshotLite = { asOf: generatedAt, dataThrough: null, opportunities: [] };
    writeArtifact(ARTIFACTS.quantSnapshot, lite);
    return {
      ok: true,
      message: "No contract bars yet — run the Databento backfill in the Data Center first.",
      runId: null,
      dataThrough: null,
      instruments: 0,
      durationMs: Date.now() - t0,
    };
  }
  const input = loadMarketInput(generatedAt);
  const res = computeQuant(input);
  const durationMs = Date.now() - t0;
  const runId = saveQuantResult(res, durationMs);
  writeArtifact(ARTIFACTS.quantSnapshot, res.lite);
  const buys = res.opportunities.conservative.filter((o) => o.verdict.action !== "AVOID").length;
  return {
    ok: true,
    message: `Analyzed ${res.instruments.length} instruments through ${res.dataThrough}; ${buys} conservative trade signal(s).`,
    runId,
    dataThrough: res.dataThrough,
    instruments: res.instruments.length,
    durationMs,
  };
}

/**
 * Run the engine off the main thread (it is ~30–60 s of CPU on full history) so
 * the API stays responsive. Falls back to running inline when a worker cannot be
 * started (e.g. under the test runner). `inline: true` forces inline.
 */
export async function runQuantEngine(opts: { inline?: boolean } = {}): Promise<QuantRunSummary> {
  if (opts.inline) return computeAndPersist();
  const isTs = import.meta.url.endsWith(".ts");
  // Under tsx the bootstrap registers the TS loader inside the worker (see worker-boot.mjs).
  const url = new URL(isTs ? "./worker-boot.mjs" : "./worker.js", import.meta.url);
  let worker: Worker;
  try {
    worker = new Worker(url, { env: process.env });
  } catch {
    return computeAndPersist();
  }
  return new Promise<QuantRunSummary>((resolve, reject) => {
    let settled = false;
    worker.once("message", (msg: { ok: boolean; summary?: QuantRunSummary; error?: string }) => {
      settled = true;
      if (msg.ok && msg.summary) resolve(msg.summary);
      else reject(new Error(msg.error ?? "quant worker failed"));
    });
    worker.once("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    worker.once("exit", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`quant worker exited with code ${code}`));
      }
    });
  });
}
