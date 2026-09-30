import type { AssetId, AssetSpec, FuturesProduct } from "../../../shared/universe.js";

/**
 * Test-only asset/product specs for assets that are not in the universe yet
 * (BTC, copper, platinum, palladium). Passed as PARAMETERS to the pure builders
 * so the generic code paths are exercised without touching `shared/universe.ts`.
 */
export function fakeAsset(over: Omit<Partial<AssetSpec>, "id"> & { id?: string } = {}): AssetSpec {
  const id = (over.id ?? "fake") as AssetId;
  return {
    label: "Fake",
    short: "Fk",
    assetClass: "precious",
    spot: "FAKE=F",
    priceUnit: "oz",
    unitLabel: "$/oz",
    displayDecimals: 2,
    session: "globex",
    futures: [],
    etfs: [],
    benchmarkEtf: "FAKE",
    physical: null,
    cot: null,
    colorVar: "--metal-gold",
    cotMarket: "",
    ...over,
    id,
    metal: id,
  };
}

/** A CME-style cash-settled product listing every month (BTC-like). */
export const FAKE_CASH: FuturesProduct = {
  root: "BTC",
  name: "CME Fake Bitcoin",
  exchange: "CME",
  yahoo: "BTC=F",
  contractSize: 5,
  pointValue: 5,
  tickSize: 5,
  activeMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  seasonalMonths: [3, 6, 9, 12],
  cashSettled: true,
  ozPerContract: 0,
};
