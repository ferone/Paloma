import { describe, it, expect } from "vitest";
import { adaptiveLookback, expectedReversionDays, ouFit, ouTradability } from "./ou.js";

/**
 * Worked numeric fixtures (house style: exact AR(1) examples, no market data).
 * A noiseless AR(1) x_{t+1} = a + b·x_t has closed-form OU parameters:
 * theta = −ln(b), halfLife = ln(2)/theta, mu = a/(1−b).
 */

/** Generate a deterministic AR(1) path. */
const ar1 = (a: number, b: number, x0: number, n: number): number[] => {
  const out = [x0];
  for (let i = 1; i < n; i++) out.push(a + b * out[i - 1]);
  return out;
};

describe("ouFit — AR(1)/OLS on the trailing window", () => {
  it("recovers b, theta, half-life, mu and r² ≈ 1 from a noiseless AR(1) decay", () => {
    // x_{t+1} = 0.9·x_t from 100 — pure decay toward 0.
    const xs = ar1(0, 0.9, 100, 200);
    const fit = ouFit(xs, 252, 120)!;
    expect(fit).not.toBeNull();
    expect(fit.b).toBeCloseTo(0.9, 6);
    expect(fit.a).toBeCloseTo(0, 6);
    expect(fit.theta).toBeCloseTo(-Math.log(0.9), 6);
    expect(fit.halfLife).toBeCloseTo(Math.log(2) / -Math.log(0.9), 3); // ≈ 6.579
    expect(fit.mu).toBeCloseTo(0, 6);
    expect(fit.r2).toBeGreaterThan(0.999);
  });

  it("recovers the long-run mean from x_{t+1} = 5 + 0.5·x_t (fixed point 10)", () => {
    const xs = ar1(5, 0.5, 0, 150);
    const fit = ouFit(xs, 252, 120)!;
    expect(fit.b).toBeCloseTo(0.5, 6);
    expect(fit.mu).toBeCloseTo(10, 4);
  });

  it("a deterministic trend (b ≥ 1) is NOT mean-reverting: halfLife = Infinity", () => {
    const xs = Array.from({ length: 150 }, (_, i) => i); // x_t = t → b = 1
    const fit = ouFit(xs, 252, 120)!;
    expect(fit.b).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(fit.halfLife).toBe(Infinity);
  });

  it("returns null below minObs", () => {
    expect(ouFit(ar1(0, 0.9, 100, 80), 252, 120)).toBeNull();
  });

  it("uses only the trailing `window` values", () => {
    // A garbage prefix followed by a clean AR(1) window must fit the window only.
    const xs = [...Array.from({ length: 100 }, (_, i) => (i % 2 ? 500 : -500)), ...ar1(0, 0.9, 100, 252)];
    const fit = ouFit(xs, 252, 120)!;
    expect(fit.b).toBeCloseTo(0.9, 6);
    expect(fit.n).toBe(252);
  });

  it("LOOK-AHEAD INVARIANCE: the fit at k is independent of later values", () => {
    const xs = ar1(0, 0.9, 100, 300);
    const atK = ouFit(xs.slice(0, 200), 252, 120)!;
    const garbage = [...xs.slice(0, 200), ...Array.from({ length: 100 }, () => 1e6)];
    const atKAfter = ouFit(garbage.slice(0, 200), 252, 120)!;
    expect(atKAfter).toEqual(atK);
  });
});

describe("ouTradability — half-life bounds gate", () => {
  const fitOf = (b: number) => ouFit(ar1(0, b, 100, 200), 252, 120)!;

  it("tradable iff halfLife within [min, max]", () => {
    const f = fitOf(0.9); // halfLife ≈ 6.579
    expect(ouTradability(f, { min: 5, max: 60 }).tradable).toBe(true);
    expect(ouTradability(f, { min: 10, max: 60 }).tradable).toBe(false);
  });

  it("no fit / trending series ⇒ NOT tradable (never manufacture reversion)", () => {
    expect(ouTradability(null, { min: 5, max: 60 }).tradable).toBe(false);
    const trend = ouFit(Array.from({ length: 150 }, (_, i) => i * 1.0), 252, 120)!;
    const t = ouTradability(trend, { min: 5, max: 60 });
    expect(t.tradable).toBe(false);
    expect(t.reason.length).toBeGreaterThan(0);
  });
});

describe("adaptiveLookback + expectedReversionDays", () => {
  const fit = ouFit(ar1(0, 0.9, 100, 200), 252, 120)!; // halfLife ≈ 6.579

  it("N_eff = clamp(round(k·halfLife), nMin, nMax); fallback when unfittable", () => {
    expect(adaptiveLookback(fit, 3, 20, 120, 60)).toBe(20); // round(19.7) → clamped to 20
    expect(adaptiveLookback(fit, 10, 20, 120, 60)).toBe(66); // round(65.79)
    expect(adaptiveLookback(null, 3, 20, 120, 60)).toBe(60);
  });

  it("expected days for |z| to decay to 0.5: ln(|z|/0.5)/theta", () => {
    const days = expectedReversionDays(2, fit)!;
    expect(days).toBeCloseTo(Math.log(2 / 0.5) / -Math.log(0.9), 3); // ≈ 13.16
    expect(expectedReversionDays(0.3, fit)).toBeNull(); // already inside the target
    expect(expectedReversionDays(2, null)).toBeNull();
  });
});
