import { Router, type Response } from "express";
import type {
  BacktestView,
  CurvePointView,
  CurveView,
  GatesResponse,
  OpportunitiesResponse,
  QuantEmpty,
  QuantMode,
  QuantOpportunity,
  QuantSnapshot,
  RecomputeResponse,
  RelativeValueDetail,
} from "../../shared/quant.js";
import { ASSETS, RELATIVE_VALUE_PAIRS, UNIVERSE, assetOfRoot, basisInstrumentId, futuresProduct, parseAssetId, yahooContractSymbol, type AssetId } from "../../shared/universe.js";
import { belongsToAsset, pairByKey, pairLegs } from "./universe/pairs.js";
import { JobBusyError, jobStatus, registerJob, runJob } from "../jobs/registry.js";
import { getBatchQuotes } from "../services/yahoo-finance.service.js";
import { hasContractData, runQuantEngine } from "./service.js";
import { latestRun, listInstruments, readInstrumentDetail, readRelativeValue, readReport, readSeasonalityDetail } from "./store.js";
import { QUANT_SOURCE, curvePoints, curveRegime, engineInfo } from "./run/compute.js";

// Domain router for /api/quant. Every data endpoint answers with either its
// payload or an explicit QuantEmpty state (no bars / not computed / computing).
export const router = Router();

export const QUANT_JOB = "quant.recompute";

registerJob(
  QUANT_JOB,
  "Recompute the Quant Lab: continuous legs, spreads, flies, seasonals, relative value, backtests",
  async (ctx) => {
    ctx.progress(0.05, "Stitching contracts and running the engine");
    const s = await runQuantEngine();
    ctx.progress(1, s.message);
    return s.message;
  },
);

const autoRecompute = () => process.env.QUANT_AUTO_RECOMPUTE !== "0";

/** The honest empty state for the current situation (may start the engine). */
function emptyState(): QuantEmpty {
  if (!hasContractData()) {
    return {
      status: "no_data",
      message: "No futures contract history is stored yet, so the Quant Lab has nothing to analyze.",
      action: "Run the Databento backfill (GLBX.MDP3, 2010 → today) in the Data Center, then recompute.",
    };
  }
  if (jobStatus(QUANT_JOB)?.state === "running") {
    return { status: "computing", message: "The engine is running on the stored contract history.", action: "This page refreshes when it finishes (≈ 1 minute)." };
  }
  if (autoRecompute()) {
    try {
      runJob(QUANT_JOB);
      return { status: "computing", message: "Contract history found; the engine has started its first run.", action: "This page refreshes when it finishes (≈ 1 minute)." };
    } catch {
      // fall through to not_computed
    }
  }
  return { status: "not_computed", message: "Contract history is stored but the engine has not run yet.", action: "Recompute the Quant Lab." };
}

function sendEmpty(res: Response): void {
  res.json(emptyState());
}

/** The asset in focus: `?asset=` (or the legacy `?metal=`), validated against the universe. */
function assetParam(q: Record<string, unknown>): AssetId {
  return parseAssetId(q.asset ?? q.metal);
}
function parseMode(v: unknown): QuantMode {
  return v === "aggressive" ? "aggressive" : "conservative";
}

/** An asset's rows plus the relative-value pairs it takes part in. */
const forAsset = (asset: AssetId) => (o: QuantOpportunity) => belongsToAsset(asset, o);

router.get("/health", (_req, res) => {
  res.json({ domain: "quant", status: "ok" });
});

router.get("/status", (_req, res) => {
  const run = latestRun();
  res.json({ run, job: jobStatus(QUANT_JOB) ?? null, hasData: hasContractData() });
});

router.get("/snapshot", (req, res) => {
  const metal = assetParam(req.query);
  const run = latestRun();
  const opps = readReport<Record<QuantMode, QuantOpportunity[]>>("opportunities");
  if (!run || !opps) return sendEmpty(res);
  const rows = opps.conservative.filter(forAsset(metal));
  const aggressive = opps.aggressive.filter(forAsset(metal));
  const body: QuantSnapshot = {
    metal,
    asOf: run.generatedAt,
    dataThrough: run.dataThrough,
    engine: engineInfo(),
    counts: {
      instruments: rows.length,
      buys: aggressive.filter((o) => o.verdict.action === "BUY").length,
      sells: aggressive.filter((o) => o.verdict.action === "SELL").length,
      passedOos: rows.filter((o) => o.oos === "passed").length,
    },
    top: rows.slice(0, 8),
    provenance: { source: QUANT_SOURCE, asOf: run.dataThrough },
    mlCounted: rows.filter((o) => o.mlCounted).length,
  };
  res.json(body);
});

router.get("/opportunities", (req, res) => {
  const metal = assetParam(req.query);
  const mode = parseMode(req.query.mode);
  const run = latestRun();
  const opps = readReport<Record<QuantMode, QuantOpportunity[]>>("opportunities");
  if (!run || !opps) return sendEmpty(res);
  const body: OpportunitiesResponse = {
    metal,
    mode,
    asOf: run.generatedAt,
    dataThrough: run.dataThrough,
    rows: opps[mode].filter(forAsset(metal)),
    provenance: { source: QUANT_SOURCE, asOf: run.dataThrough, note: `${mode} verdicts; ranked by the fixed-weight QT composite` },
  };
  res.json(body);
});

router.get("/instruments", (req, res) => {
  if (!latestRun()) return sendEmpty(res);
  res.json(listInstruments((req.query.asset ?? req.query.metal) ? assetParam(req.query) : undefined));
});

router.get("/instrument/:id", (req, res) => {
  if (!latestRun()) return sendEmpty(res);
  const d = readInstrumentDetail(req.params.id);
  const basisAsset = ASSETS.find((a) => basisInstrumentId(a) === req.params.id);
  if (!d && basisAsset) {
    // A declared basis that the engine could not build: say what is missing.
    const b = UNIVERSE[basisAsset].basis!;
    const root = UNIVERSE[basisAsset].futures[0].root;
    const empty: QuantEmpty = {
      status: "no_data",
      message: `The ${UNIVERSE[basisAsset].label.toLowerCase()} cash-and-carry basis needs ${root} contract history plus daily ${b.spot} and ${b.rate} closes, and enough overlapping history for a z-score.`,
      action: `Backfill ${root} and refresh the Yahoo daily history (${b.spot}, ${b.rate}) in the Data Center, then recompute.`,
    };
    return res.json(empty);
  }
  if (!d) return res.status(404).json({ error: `Unknown or unanalyzed instrument: ${req.params.id}` });
  res.json(d);
});

router.get("/seasonality/:id", (req, res) => {
  if (!latestRun()) return sendEmpty(res);
  const d = readSeasonalityDetail(req.params.id);
  if (!d) return res.status(404).json({ error: `No seasonality for ${req.params.id}` });
  res.json(d);
});

router.get("/relative-value", (req, res) => {
  const key = String(req.query.pair ?? RELATIVE_VALUE_PAIRS[0]?.key ?? "");
  const pair = pairByKey(key);
  if (!pair) return res.status(400).json({ error: `Unknown pair ${key}; supported: ${RELATIVE_VALUE_PAIRS.map((p) => p.key).join(", ")}` });
  if (!latestRun()) return sendEmpty(res);
  const rv = readRelativeValue<RelativeValueDetail>(pair.key);
  if (!rv) {
    const legs = pairLegs(pair);
    const name = `${UNIVERSE[pair.numerator].label.toLowerCase()}/${UNIVERSE[pair.denominator].label.toLowerCase()}`;
    const roots = legs ? `${legs.numFut.root} and ${legs.denFut.root}` : "futures on both legs";
    const empty: QuantEmpty = legs
      ? { status: "no_data", message: `The ${name} relative value needs both ${roots} contract history.`, action: `Backfill both ${roots} in the Data Center, then recompute.` }
      : { status: "no_data", message: `The ${name} relative value needs listed futures on both legs.`, action: "Add futures for both assets to the universe." };
    return res.json(empty);
  }
  res.json(rv);
});

router.get("/backtest", (req, res) => {
  const metal = assetParam(req.query);
  const mode = parseMode(req.query.mode);
  if (!latestRun()) return sendEmpty(res);
  const b = readReport<BacktestView>(`backtest:${metal}:${mode}`);
  if (!b) return res.json({ status: "no_data", message: `No ${UNIVERSE[metal].label.toLowerCase()} history long enough to replay.`, action: "Backfill more history in the Data Center." } satisfies QuantEmpty);
  res.json(b);
});

router.get("/gates", (req, res) => {
  const metal = assetParam(req.query);
  if (!latestRun()) return sendEmpty(res);
  const g = readReport<GatesResponse>(`gates:${metal}`);
  if (!g) return res.json({ status: "no_data", message: "No point-in-time decisions to ablate yet.", action: "Backfill more history in the Data Center." } satisfies QuantEmpty);
  res.json(g);
});

router.post("/recompute", (_req, res) => {
  try {
    const s = runJob(QUANT_JOB);
    const body: RecomputeResponse = { job: QUANT_JOB, state: s.state, startedAt: s.startedAt };
    res.status(202).json(body);
  } catch (err) {
    if (err instanceof JobBusyError) {
      const s = jobStatus(QUANT_JOB);
      res.status(409).json({ job: QUANT_JOB, state: "running", startedAt: s?.startedAt ?? null, error: err.message });
    } else throw err;
  }
});

// ── term structure (stored bars + Yahoo live fallback) ──────────────────────
const liveCache = new Map<string, { at: number; value: { asOf: string; points: CurvePointView[] } | null; note: string | null }>();
const LIVE_TTL_MS = 5 * 60_000;

async function yahooCurve(root: string): Promise<{ value: { asOf: string; points: CurvePointView[] } | null; note: string | null }> {
  const hit = liveCache.get(root);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit;
  const product = futuresProduct(root);
  if (!product) return { value: null, note: null };
  const today = new Date();
  const y0 = today.getUTCFullYear();
  const m0 = today.getUTCMonth() + 1;
  const wanted: { symbol: string; month: number; year: number }[] = [];
  for (let k = 0; k < 30 && wanted.length < 8; k++) {
    const total = y0 * 12 + (m0 - 1) + k;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    if (product.activeMonths.includes(month)) wanted.push({ symbol: yahooContractSymbol(root, month, year), month, year });
  }
  let result: { value: { asOf: string; points: CurvePointView[] } | null; note: string | null };
  try {
    const quotes = await getBatchQuotes(wanted.map((w) => w.symbol));
    const by = new Map(quotes.map((q) => [q.symbol, q]));
    const asOf = today.toISOString().slice(0, 10);
    const rows = wanted
      .map((w) => ({ w, q: by.get(w.symbol) }))
      .filter((x) => x.q && x.q.price > 0)
      .map(({ w, q }) => ({ symbol: w.symbol.replace(/\.[A-Z]+$/, ""), month: w.month, year: w.year, lastTrade: null, price: q!.price, volume: q!.volume || null, openInterest: null }));
    result = rows.length >= 2
      ? { value: { asOf, points: curvePoints(root, asOf, rows, "yahoo") }, note: "Yahoo Finance delayed quotes for the listed active months (live fallback)." }
      : { value: null, note: "Yahoo returned no quotes for the listed contract months." };
  } catch {
    result = { value: null, note: "Yahoo live quotes unavailable right now." };
  }
  liveCache.set(root, { at: Date.now(), ...result });
  return result;
}

router.get("/curve/:root", async (req, res) => {
  const root = req.params.root.toUpperCase();
  const product = futuresProduct(root);
  if (!product) return res.status(404).json({ error: `Unknown futures root ${root}` });
  const metal = assetOfRoot(root)!;
  const wantLive = req.query.live !== "0";
  const stored = readReport<CurveView>(`curve:${root}`);
  const live = wantLive ? await yahooCurve(root) : { value: null, note: null };
  if (!stored && !live.value) return sendEmpty(res);
  if (stored) {
    res.json({ ...stored, live: live.value, liveNote: live.note } satisfies CurveView);
    return;
  }
  // Live-only fallback: no stored bars for this root yet.
  const points = live.value!.points;
  const act = points.filter((p) => p.active);
  const body: CurveView = {
    root,
    metal,
    asOf: live.value!.asOf,
    regime: curveRegime(points),
    frontCarry: act[1]?.annualizedCarry ?? null,
    points,
    prior: null,
    live: null,
    liveNote: "No stored Databento bars for this product yet — showing Yahoo delayed quotes only.",
    provenance: { source: "Yahoo Finance (delayed)", asOf: live.value!.asOf, note: "Live fallback until the Databento backfill runs" },
  };
  res.json(body);
});
