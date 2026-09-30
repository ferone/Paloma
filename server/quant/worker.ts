import { parentPort } from "node:worker_threads";
import { computeAndPersist } from "./service.js";

// Worker-thread entry for the quant engine (see service.ts runQuantEngine).
// It opens its own SQLite connection (WAL allows the API to keep reading).
try {
  const summary = computeAndPersist();
  parentPort?.postMessage({ ok: true, summary });
} catch (err) {
  parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
}
