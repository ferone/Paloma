import { describe, it, expect } from "vitest";
import type { SeriesPoint, SignalRow } from "../types/index.js";
import { buildOpportunity, buildOpportunities, type OppInput } from "./build.js";

const iso = (year: number, doy: number): string =>
  new Date(Date.UTC(year, 0, doy)).toISOString().slice(0, 10);

function risingFixture(years: number[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const y of years) for (let doy = 1; doy <= 120; doy++) out.push({ date: iso(y, doy), value: doy * 0.1 });
  return out;
}

const sig = (over: Partial<SignalRow>): SignalRow => ({
  pairId: "X",
  date: "2022-02-15",
  spread: 1,
  z: -2,
  seasonFactor: 0,
  fundFactor: 0,
  base: 73,
  score: 73,
  tier: "STRONG",
  avoidOverride: false,
  configVersion: 1,
  ...over,
});

const series = risingFixture([2015, 2016, 2017, 2018, 2019, 2020, 2021]);

describe("buildOpportunity", () => {
  it("boosts rank when an active seasonal window agrees with the z-fade", () => {
    const input: OppInput = {
      instrumentId: "LE",
      label: "Live Cattle",
      asOf: "2022-02-15", // inside the rising-series long window
      pointValue: 10,
      series,
      latest: sig({ z: -2, score: 73 }), // low spread → fade LONG, agrees with rising window
    };
    const opp = buildOpportunity(input);
    expect(opp.seasonalWindow).not.toBeNull();
    expect(opp.seasonalWindow!.side).toBe("long");
    expect(opp.compositeRank).toBeGreaterThan(73); // score + positive seasonal boost
    expect(opp.evidence.some((e) => /agrees with z/.test(e))).toBe(true);
  });

  it("only counts ML when validationStatus === passed", () => {
    const baseInput: OppInput = {
      instrumentId: "LE",
      label: "LE",
      asOf: "2022-02-15",
      pointValue: 10,
      series,
      latest: sig({}),
    };
    const passed = buildOpportunity({
      ...baseInput,
      ml: { instrumentId: "LE", date: "2022-02-15", pConverge: 0.9, expectedMove: 500, confidence: 0.8, validationStatus: "passed" },
    });
    const untested = buildOpportunity({
      ...baseInput,
      ml: { instrumentId: "LE", date: "2022-02-15", pConverge: 0.9, expectedMove: 500, confidence: 0.8, validationStatus: "untested" },
    });
    expect(passed.mlProb).toBe(0.9);
    expect(untested.mlProb).toBeNull();
    expect(passed.compositeRank).toBeGreaterThan(untested.compositeRank);
  });

  it("ranks the universe by compositeRank desc", () => {
    const ranked = buildOpportunities([
      { instrumentId: "A", label: "A", asOf: "2022-02-15", pointValue: 10, series, latest: sig({ score: 30 }) },
      { instrumentId: "B", label: "B", asOf: "2022-02-15", pointValue: 10, series, latest: sig({ score: 90 }) },
    ]);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
  });
});
