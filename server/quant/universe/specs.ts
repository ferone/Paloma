import { futuresProduct } from "../../../shared/universe.js";
import { monthCode } from "./contracts.js";

/**
 * Static COMEX contract SPECIFICATIONS for the metals this fund trades — the
 * reference data behind the "Contract specifications" panel (exchange, size,
 * price unit, tick, $ point value, active months). Published exchange metadata,
 * not market data, so hard-coding the canonical values is appropriate. The $
 * point value and active months are read from `shared/universe.ts` (the single
 * source of truth) so they can never drift from the rest of the app. PURE.
 */
export interface ContractSpec {
  product: string; // root, e.g. "GC"
  name: string;
  exchange: string; // "COMEX"
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

function spec(root: string, s: Omit<ContractSpec, "product" | "pointValue" | "months" | "monthCodes">): ContractSpec {
  const p = futuresProduct(root);
  if (!p) throw new Error(`specs: ${root} is not in shared/universe.ts`);
  return {
    product: root,
    ...s,
    pointValue: p.pointValue,
    months: [...p.activeMonths],
    monthCodes: p.activeMonths.map((m) => monthCode(m)).join(" "),
  };
}

const GLOBEX_HOURS = "Sun–Fri 5:00 p.m.–4:00 p.m. CT (CME Globex, 60-min break 4–5 p.m.)";

// QUOTE-UNIT TRAP: gold and silver are quoted in $/oz — NOT cents. The point
// value absorbs the contract size; never rescale by 100.
export const SPECS: Record<string, ContractSpec> = {
  GC: spec("GC", {
    name: "Gold",
    exchange: "COMEX",
    contractSize: "100 troy oz",
    priceUnit: "$/oz",
    tickSize: 0.1,
    tickValue: 10,
    tradingHours: GLOBEX_HOURS,
    settlement: "Physical delivery",
  }),
  MGC: spec("MGC", {
    name: "Micro Gold",
    exchange: "COMEX",
    contractSize: "10 troy oz",
    priceUnit: "$/oz",
    tickSize: 0.1,
    tickValue: 1,
    tradingHours: GLOBEX_HOURS,
    settlement: "Physical delivery",
  }),
  SI: spec("SI", {
    name: "Silver",
    exchange: "COMEX",
    contractSize: "5,000 troy oz",
    priceUnit: "$/oz",
    tickSize: 0.005,
    tickValue: 25,
    tradingHours: GLOBEX_HOURS,
    settlement: "Physical delivery",
  }),
  SIL: spec("SIL", {
    name: "Micro Silver",
    exchange: "COMEX",
    contractSize: "1,000 troy oz",
    priceUnit: "$/oz",
    tickSize: 0.005,
    tickValue: 5,
    tradingHours: GLOBEX_HOURS,
    settlement: "Physical delivery",
  }),
};

/** Spec by product root or contract symbol (e.g. "GC" or "GCZ26"). PURE. */
export function getSpec(productOrSymbol: string): ContractSpec | undefined {
  if (SPECS[productOrSymbol]) return SPECS[productOrSymbol];
  const root = productOrSymbol.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "");
  return SPECS[root];
}
