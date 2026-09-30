import type { Instrument } from "../types/index.js";
import { ASSETS, UNIVERSE, type AssetId, type FuturesProduct } from "../../../shared/universe.js";
import { GLBX, pairInstruments, resolvedPairs } from "./pairs.js";

/**
 * The instrument universe the quant engine analyzes, generated from
 * `shared/universe.ts`: every futures root of every asset, plus the
 * relative-value pairs of `RELATIVE_VALUE_PAIRS`. Each entry is a weighted
 * basket of CONTINUOUS legs (`<root>.c.N`, stitched from specific Databento
 * GLBX.MDP3 contracts restricted to the product's ACTIVE months — see
 * `data/continuous.ts`) with a `pointValue` ($ per 1.0 of the combined value per
 * contract — the "dollar meter").
 *
 * Per futures root (e.g. GC, MGC, SI, SIL):
 *   X.out        +1·c0                 front outright
 *   X.cal.0-1    +1·c0 −1·c1           front calendar
 *   X.cal.1-2    +1·c1 −1·c2           deferred calendar
 *   X.fly.0-1-2  +1·c0 −2·c1 +1·c2     butterfly (= −2·curvature)
 *
 * Relative value per pair (see `pairs.ts`), e.g. gold/silver:
 *   GS.ratio     GC.c0 / SI.c0              the gold/silver ratio (non-linear; built directly)
 *   GS.spread    +100·GC.c0 −5000·SI.c0     one-contract dollar-notional spread (weights are
 *                                            each leg's pointValue ⇒ pointValue 1)
 *
 * The universe carries NO fundamentals (no USDA-style supply index), so the
 * engine's fundamental factor is neutral by design (F = 0 ⇒ fund_factor = 0).
 * An asset's first futures product is its full-size contract; the rest (MGC,
 * SIL, …) are sizing mirrors of the same curve.
 */

export { GLBX };

function leg(root: string, n: number) {
  return `${root}.c.${n}`;
}

/** Product name without its exchange prefix ("COMEX Micro Gold" → "Micro Gold"). */
function displayName(f: FuturesProduct): string {
  return f.name.replace(new RegExp(`^${f.exchange} `), "");
}

function structures(root: string, metal: AssetId, name: string, pointValue: number): Instrument[] {
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

/** Relative-value instruments for every resolvable pair (attributed to the numerator asset; shown for both). */
export const RELATIVE_VALUE: Instrument[] = resolvedPairs().flatMap(pairInstruments);

export const REGISTRY: Instrument[] = [
  ...ASSETS.flatMap((asset) => UNIVERSE[asset].futures.flatMap((f) => structures(f.root, asset, displayName(f), f.pointValue))),
  ...RELATIVE_VALUE,
];

/** Micro/mini roots: sizing mirrors of an asset's full-size curve (every product after the first). */
export const MIRROR_ROOTS: ReadonlySet<string> = new Set(ASSETS.flatMap((a) => UNIVERSE[a].futures.slice(1).map((f) => f.root)));

export function getInstrument(id: string): Instrument | undefined {
  return REGISTRY.find((i) => i.id === id);
}

/** Every continuous leg symbol the registry needs, de-duplicated. */
export function allSymbols(): string[] {
  return [...new Set(REGISTRY.flatMap((i) => i.legs.map((l) => l.symbol)))];
}

/** Roots whose continuous legs the registry references (every futures root in the universe). */
export function allRoots(): string[] {
  return [...new Set(allSymbols().map((s) => s.split(".")[0]))];
}
