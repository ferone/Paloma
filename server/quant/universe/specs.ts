import { ASSETS, UNIVERSE, type AssetSpec, type FuturesProduct, type PriceUnit } from "../../../shared/universe.js";
import { monthCode } from "./contracts.js";

/**
 * Contract SPECIFICATIONS for every futures product in the universe — the
 * reference data behind the "Contract specifications" panel (exchange, size,
 * price unit, tick, $ point value, active months). Everything is GENERATED from
 * `shared/universe.ts` (the single source of truth), so adding an asset there
 * adds its specs here with no code change, and the $ point value / tick / months
 * can never drift from the rest of the app. PURE.
 */
export interface ContractSpec {
  product: string; // root, e.g. "GC"
  name: string;
  exchange: string; // "COMEX" | "NYMEX" | "CME"
  contractSize: string; // human-readable, e.g. "100 troy oz"
  priceUnit: string; // "$/oz"
  tickSize: number; // minimum price increment, in price units
  tickValue: number; // $ per tick
  pointValue: number; // $ per 1.0 of the price unit
  months: number[]; // ACTIVE contract months (1..12) — serial months are ignored
  monthCodes: string; // CME month-code letters, space-separated
  tradingHours?: string;
  settlement?: string;
}

const GLOBEX_HOURS = "Sun–Fri 5:00 p.m.–4:00 p.m. CT (CME Globex, 60-min break 4–5 p.m.)";

/** Human unit for a contract size ("troy oz" for precious metals, "lb", "BTC"). */
const SIZE_UNIT: Record<PriceUnit, string> = { oz: "troy oz", lb: "lb", BTC: "BTC" };

/** Strip the exchange prefix from a product name ("COMEX Micro Gold" → "Micro Gold"). */
function shortName(p: FuturesProduct): string {
  return p.name.replace(new RegExp(`^${p.exchange} `), "");
}

/** Round away binary noise (0.1 × 100 must be exactly 10). */
function clean(x: number): number {
  return Math.round(x * 1e9) / 1e9;
}

/**
 * The spec for one futures product of an asset. PURE.
 * QUOTE-UNIT TRAP: prices are in the asset's `unitLabel` (e.g. $/oz, NOT cents);
 * the point value absorbs the contract size — never rescale by 100.
 */
export function specFor(asset: AssetSpec, p: FuturesProduct): ContractSpec {
  return {
    product: p.root,
    name: shortName(p),
    exchange: p.exchange,
    contractSize: `${p.contractSize.toLocaleString("en-US")} ${SIZE_UNIT[asset.priceUnit]}`,
    priceUnit: asset.unitLabel,
    tickSize: p.tickSize,
    tickValue: clean(p.tickSize * p.pointValue),
    pointValue: p.pointValue,
    months: [...p.activeMonths],
    monthCodes: p.activeMonths.map((m) => monthCode(m)).join(" "),
    tradingHours: GLOBEX_HOURS,
    settlement: p.cashSettled ? "Cash settlement" : "Physical delivery",
  };
}

/** Specs for every futures root of the given assets. PURE. */
export function buildSpecs(assets: readonly AssetSpec[]): Record<string, ContractSpec> {
  const out: Record<string, ContractSpec> = {};
  for (const a of assets) for (const p of a.futures) out[p.root] = specFor(a, p);
  return out;
}

export const SPECS: Record<string, ContractSpec> = buildSpecs(ASSETS.map((a) => UNIVERSE[a]));

/** Spec by product root or contract symbol (e.g. "GC" or "GCZ26"). Undefined for unknown roots. PURE. */
export function getSpec(productOrSymbol: string): ContractSpec | undefined {
  if (SPECS[productOrSymbol]) return SPECS[productOrSymbol];
  const root = productOrSymbol.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "");
  return SPECS[root];
}
