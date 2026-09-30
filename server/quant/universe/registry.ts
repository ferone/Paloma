import type { Instrument } from "../types/index.js";
import { UNIVERSE, METALS, type Metal } from "../../../shared/universe.js";

/**
 * The instrument universe the quant engine analyzes — gold and silver,
 * symmetric. Each entry is a weighted basket of CONTINUOUS legs (`<root>.c.N`,
 * stitched from specific Databento GLBX.MDP3 contracts restricted to the
 * product's ACTIVE months — see `data/continuous.ts`) with a `pointValue` ($ per
 * 1.0 of the combined value per contract — the "dollar meter").
 *
 * Per futures root (GC, MGC, SI, SIL):
 *   X.out        +1·c0                 front outright
 *   X.cal.0-1    +1·c0 −1·c1           front calendar
 *   X.cal.1-2    +1·c1 −1·c2           deferred calendar
 *   X.fly.0-1-2  +1·c0 −2·c1 +1·c2     butterfly (= −2·curvature)
 *
 * Relative value (gold vs silver):
 *   GS.ratio     GC.c0 / SI.c0         the gold/silver ratio (non-linear; built directly)
 *   GS.spread    +100·GC.c0 −5000·SI.c0  one-contract dollar-notional spread ($-absorbed
 *                                        weights ⇒ pointValue 1); read through its z (vol-normalised)
 *
 * Metals carry NO fundamentals (no USDA-style supply index), so the engine's
 * fundamental factor is neutral by design (F = 0 ⇒ fund_factor = 0).
 * The micro contracts (MGC, SIL) are sizing mirrors of the full-size curve.
 */

export const GLBX = "GLBX.MDP3";

function leg(root: string, n: number) {
  return `${root}.c.${n}`;
}

function structures(root: string, metal: Metal, name: string, pointValue: number): Instrument[] {
  const base = { product: root, metal, pointValue, dataset: GLBX, stypeIn: "continuous" } as const;
  return [
    { ...base, id: `${root}.out`, label: `${name} — front outright`, kind: "outright", legs: [{ symbol: leg(root, 0), weight: 1 }] },
    {
      ...base,
      id: `${root}.cal.0-1`,
      label: `${name} — front calendar (c0−c1)`,
      kind: "calendar",
      legs: [
        { symbol: leg(root, 0), weight: 1 },
        { symbol: leg(root, 1), weight: -1 },
      ],
    },
    {
      ...base,
      id: `${root}.cal.1-2`,
      label: `${name} — deferred calendar (c1−c2)`,
      kind: "calendar",
      legs: [
        { symbol: leg(root, 1), weight: 1 },
        { symbol: leg(root, 2), weight: -1 },
      ],
    },
    {
      ...base,
      id: `${root}.fly.0-1-2`,
      label: `${name} butterfly (c0−2·c1+c2)`,
      kind: "butterfly",
      legs: [
        { symbol: leg(root, 0), weight: 1 },
        { symbol: leg(root, 1), weight: -2 },
        { symbol: leg(root, 2), weight: 1 },
      ],
    },
  ];
}

const GOLD = UNIVERSE.gold.futures[0];
const SILVER = UNIVERSE.silver.futures[0];

/** Relative-value instruments across the two metals (attributed to gold for the metal switch AND shown for silver). */
export const RELATIVE_VALUE: Instrument[] = [
  {
    id: "GS.ratio",
    label: "Gold/silver ratio (GC ÷ SI)",
    product: "GS",
    metal: "gold",
    kind: "ratio",
    legs: [
      { symbol: leg(GOLD.root, 0), weight: 1 },
      { symbol: leg(SILVER.root, 0), weight: -1 },
    ],
    // The ratio is a quotient, not a weighted sum: P&L is booked on a dollar-neutral
    // pair ($100k notional per leg) through Δln(ratio) — see engine/run.ts.
    pointValue: 1,
    dataset: GLBX,
    stypeIn: "continuous",
  },
  {
    id: "GS.spread",
    label: "Gold − silver dollar spread (1 GC vs 1 SI)",
    product: "GS",
    metal: "gold",
    kind: "inter",
    legs: [
      { symbol: leg(GOLD.root, 0), weight: GOLD.pointValue },
      { symbol: leg(SILVER.root, 0), weight: -SILVER.pointValue },
    ],
    pointValue: 1, // weights absorb $/point ⇒ the combined value is already dollars
    dataset: GLBX,
    stypeIn: "continuous",
  },
];

export const REGISTRY: Instrument[] = [
  ...METALS.flatMap((metal) => UNIVERSE[metal].futures.flatMap((f) => structures(f.root, metal, f.name.replace(/^COMEX /, ""), f.pointValue))),
  ...RELATIVE_VALUE,
];

export function getInstrument(id: string): Instrument | undefined {
  return REGISTRY.find((i) => i.id === id);
}

/** Every continuous leg symbol the registry needs, de-duplicated. */
export function allSymbols(): string[] {
  return [...new Set(REGISTRY.flatMap((i) => i.legs.map((l) => l.symbol)))];
}

/** Roots whose continuous legs the registry references (GC, MGC, SI, SIL). */
export function allRoots(): string[] {
  return [...new Set(allSymbols().map((s) => s.split(".")[0]))];
}
