import { computeAndPersist } from "./service.js";

// `npm run quant:recompute` — run the quant engine once against the local DB
// (DB_PATH, default data/gold.db) without starting the API server.
const s = computeAndPersist();
console.log(`[quant] ${s.message} (${(s.durationMs / 1000).toFixed(1)} s${s.runId ? `, run #${s.runId}` : ""})`);
