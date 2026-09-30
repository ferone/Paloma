import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { useTestDb } from "../db/client.js";
import { upsertContractBars, upsertContracts } from "../db/shared-repo.js";
import { readArtifact } from "../db/repo.js";
import { ARTIFACTS, type QuantSnapshotLite } from "../../shared/artifacts.js";
import type {
  BacktestView,
  CurveView,
  GatesResponse,
  InstrumentDetail,
  OpportunitiesResponse,
  QuantEmpty,
  QuantSnapshot,
  RelativeValueDetail,
  SeasonalityDetail,
} from "../../shared/quant.js";
import { router } from "./router.js";
import { runQuantEngine } from "./service.js";
import { makeFixture } from "./testing/fixture.js";

let server: Server;
let base = "";
const get = async <T>(path: string): Promise<{ status: number; body: T }> => {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: (await r.json()) as T };
};

beforeAll(async () => {
  process.env.QUANT_AUTO_RECOMPUTE = "0";
  useTestDb();
  const app = express();
  app.use(express.json());
  app.use("/api/quant", router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  // The inline engine run blocks for a while; keep idle sockets alive across it.
  server.keepAliveTimeout = 600_000;
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
});

describe("/api/quant", () => {
  it("answers an explicit no-data state while contract_bars is empty", async () => {
    const { body } = await get<QuantEmpty>("/api/quant/snapshot?metal=gold");
    expect(body.status).toBe("no_data");
    expect(body.action).toMatch(/Databento backfill/);
    const opp = await get<QuantEmpty>("/api/quant/opportunities?metal=silver&mode=aggressive");
    expect(opp.body.status).toBe("no_data");
  });

  it("a run with no bars still publishes an (empty) quant:snapshot artifact", async () => {
    const s = await runQuantEngine({ inline: true });
    expect(s.runId).toBeNull();
    const lite = readArtifact<QuantSnapshotLite>(ARTIFACTS.quantSnapshot)!.data;
    expect(lite.opportunities).toEqual([]);
    expect(lite.dataThrough).toBeNull();
  });

  it("after the backfill + recompute, every endpoint serves real payloads", async () => {
    // TEST-ONLY fixture standing in for the Databento backfill.
    for (const [root, spot0, vol, seed] of [
      ["GC", 1500, 0.009, 5],
      ["SI", 22, 0.016, 6],
    ] as const) {
      const f = makeFixture({ root, startYear: 2014, endDate: "2024-03-28", spot0, vol, seed });
      upsertContracts(f.contracts);
      upsertContractBars(f.bars.map((b) => ({ ...b, open: null, high: null, low: null, source: "fixture" })));
    }
    const before = await get<QuantEmpty>("/api/quant/snapshot?metal=gold");
    expect(before.body.status).toBe("not_computed");

    const summary = await runQuantEngine({ inline: true });
    expect(summary.runId).not.toBeNull();
    expect(summary.dataThrough).toBe("2024-03-28");

    const snap = await get<QuantSnapshot>("/api/quant/snapshot?metal=silver");
    expect(snap.body.metal).toBe("silver");
    expect(snap.body.dataThrough).toBe("2024-03-28");
    expect(snap.body.top.every((o) => o.metal === "silver" || o.product === "GS")).toBe(true);

    const opp = await get<OpportunitiesResponse>("/api/quant/opportunities?metal=gold&mode=aggressive");
    expect(opp.body.mode).toBe("aggressive");
    expect(opp.body.rows.length).toBeGreaterThan(5);
    expect(opp.body.rows[0].verdict.mode).toBe("aggressive");

    const inst = await get<InstrumentDetail>("/api/quant/instrument/GC.fly.0-1-2");
    expect(inst.status).toBe(200);
    expect(inst.body.kind).toBe("butterfly");
    expect(inst.body.series.length).toBeGreaterThan(1000);
    expect(inst.body.plan.legs).toHaveLength(3);

    expect((await get("/api/quant/instrument/NOPE")).status).toBe(404);

    const seas = await get<SeasonalityDetail>("/api/quant/seasonality/SI.seas.N-U");
    expect(seas.status).toBe(200);
    expect(seas.body.envelope.length).toBeGreaterThan(50);

    const rv = await get<RelativeValueDetail>("/api/quant/relative-value?pair=gold-silver");
    expect(rv.body.pair).toBe("gold-silver");
    expect(rv.body.ratio.series.length).toBeGreaterThan(1000);

    const curve = await get<CurveView>("/api/quant/curve/GC?live=0");
    expect(curve.body.root).toBe("GC");
    expect(curve.body.points.length).toBeGreaterThan(2);
    expect(curve.body.live).toBeNull();

    const bt = await get<BacktestView>("/api/quant/backtest?metal=gold&mode=conservative");
    expect(bt.body.mode).toBe("conservative");
    expect(bt.body.equity.length).toBe(bt.body.totals.decisions);

    const gates = await get<GatesResponse>("/api/quant/gates?metal=silver");
    expect(gates.body.rows.map((r) => r.gate)).toEqual(["ou", "carry"]);

    const lite = readArtifact<QuantSnapshotLite>(ARTIFACTS.quantSnapshot)!.data;
    expect(lite.dataThrough).toBe("2024-03-28");
    expect(lite.opportunities.length).toBeGreaterThan(0);
  }, 240_000);

  it("rejects unsupported pairs and unknown roots", async () => {
    expect((await get("/api/quant/relative-value?pair=gold-copper")).status).toBe(400);
    expect((await get("/api/quant/curve/XX?live=0")).status).toBe(404);
  });
});
