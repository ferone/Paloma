import { RELATIVE_VALUE_PAIRS, UNIVERSE, type AssetClass, type AssetId, type RelativeValuePair } from '../../shared/universe.js'
import type { CotPoint, CotReportFamily, MacroRegime, MacroSeriesSnapshot, RegimePart, ScorecardRow, Stance } from '../../shared/macro.js'
import { ratioLabel, ratioSeriesId } from './catalog.js'
import { speculatorOf } from './cot.js'

// Transparent macro scorecard. Every driver maps its current reading to a
// stance for the asset through an explicit, documented threshold rule. The
// rules are deliberately simple and symmetric so a reader can verify them by
// hand from the numbers shown next to each row. Changes are 3-month changes
// (latest vs the observation on/before the same date three months earlier).
//
// Drivers are declared per asset CLASS (precious / industrial / crypto). A
// class set is data: adding an asset of an existing class needs no code here.

export const THRESHOLDS = {
  realYield3mPp: 0.15,
  dollar3mPct: 0.015,
  breakeven3mPp: 0.1,
  fedFunds3mPp: 0.1,
  cpiHigh: 3,
  cpiLow: 2,
  m2High: 5,
  m2Low: 0,
  vixStress: 25,
  vixCalm: 14,
  vixZStress: 1,
  hySpread3mPp: 0.5,
  gsrZ: 1,
  cotCrowded: 0.85,
  cotWashed: 0.15,
  riskOffVix: 22,
  riskOnVix: 15,
  hyZRiskOff: 1,
  indproHigh: 2,
  indproLow: 0,
  qqq3mPct: 0.05,
} as const

const T = THRESHOLDS
const pp = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}pp`
export function ordinal(n: number): string {
  const r100 = n % 100
  const s = r100 >= 11 && r100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${s}`
}
/** One decimal with a typographic minus. */
const n1 = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`
const pc = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`

interface RuleResult {
  stance: Stance
  reason: string
}

/**
 * How an asset reacts to equity/credit stress. `haven`: stress is a tailwind
 * (safe-haven demand). `cyclical`: stress is a headwind, calm a tailwind.
 * Assets not listed are cyclical.
 */
export type RiskRole = 'haven' | 'cyclical'
export const RISK_ROLE: Partial<Record<AssetId, RiskRole>> = { gold: 'haven' }
export const riskRole = (a: AssetId): RiskRole => RISK_ROLE[a] ?? 'cyclical'

export interface DriverRule {
  id: string
  seriesId: string
  label: string
  rule: (a: AssetId) => string
  evaluate: (s: MacroSeriesSnapshot, a: AssetId) => RuleResult
}

export interface DriverSet {
  /** Series-based drivers, in display order. */
  drivers: DriverRule[]
  /** Drivers built per relative-value pair the asset belongs to (e.g. the GSR for silver). */
  pairDrivers: (a: AssetId) => DriverRule[]
  /** Append the COT speculator-positioning driver when the asset has a COT market. */
  positioning: boolean
}

const noData: RuleResult = { stance: 'neutral', reason: 'Insufficient data' }

// ── Reusable rules ─────────────────────────────────────────────────────────

const realYield: DriverRule = {
  id: 'DFII10',
  seriesId: 'DFII10',
  label: 'Real yield (10y TIPS)',
  rule: () => `3m change ≤ −${T.realYield3mPp}pp → tailwind (lower opportunity cost); ≥ +${T.realYield3mPp}pp → headwind`,
  evaluate: (s) => {
    const c = s.change3m
    if (c == null) return noData
    if (c <= -T.realYield3mPp) return { stance: 'tailwind', reason: `Real yield ${pp(c)} over 3m: falling` }
    if (c >= T.realYield3mPp) return { stance: 'headwind', reason: `Real yield ${pp(c)} over 3m: rising` }
    return { stance: 'neutral', reason: `Real yield ${pp(c)} over 3m: within ±${T.realYield3mPp}pp` }
  },
}

const broadDollar = (why: string): DriverRule => ({
  id: 'DTWEXBGS',
  seriesId: 'DTWEXBGS',
  label: 'Broad dollar',
  rule: () => `3m change ≤ −${T.dollar3mPct * 100}% → tailwind (${why}); ≥ +${T.dollar3mPct * 100}% → headwind`,
  evaluate: (s) => {
    const c = s.change3m
    if (c == null) return noData
    if (c <= -T.dollar3mPct) return { stance: 'tailwind', reason: `Dollar ${pc(c)} over 3m: weakening` }
    if (c >= T.dollar3mPct) return { stance: 'headwind', reason: `Dollar ${pc(c)} over 3m: strengthening` }
    return { stance: 'neutral', reason: `Dollar ${pc(c)} over 3m: within ±${T.dollar3mPct * 100}%` }
  },
})

const m2Growth: DriverRule = {
  id: 'M2_YOY',
  seriesId: 'M2_YOY',
  label: 'M2 money growth (YoY)',
  rule: () => `YoY ≥ ${T.m2High}% → tailwind (monetary expansion); ≤ ${T.m2Low}% → headwind (contraction)`,
  evaluate: (s) => {
    const v = s.latest
    if (v == null) return noData
    if (v >= T.m2High) return { stance: 'tailwind', reason: `M2 ${v.toFixed(1)}% YoY: expanding fast` }
    if (v <= T.m2Low) return { stance: 'headwind', reason: `M2 ${v.toFixed(1)}% YoY: contracting` }
    return { stance: 'neutral', reason: `M2 ${v.toFixed(1)}% YoY: moderate` }
  },
}

/** VIX: a haven benefits from stress; a cyclical asset suffers from it and likes calm. */
const vix = (cyclicalWhy: (a: AssetId) => string, stressCopy: (a: AssetId) => string): DriverRule => ({
  id: 'VIXCLS',
  seriesId: 'VIXCLS',
  label: 'Equity volatility (VIX)',
  rule: (a) =>
    riskRole(a) === 'haven'
      ? `VIX ≥ ${T.vixStress} or 3y z ≥ ${T.vixZStress} → tailwind (safe-haven demand); otherwise neutral`
      : `VIX ≥ ${T.vixStress} or 3y z ≥ ${T.vixZStress} → headwind (${cyclicalWhy(a)}); VIX ≤ ${T.vixCalm} → tailwind`,
  evaluate: (s, a) => {
    const v = s.latest
    if (v == null) return noData
    const stress = v >= T.vixStress || (s.z != null && s.z >= T.vixZStress)
    const zTxt = s.z != null ? `, z ${n1(s.z)}` : ''
    const haven = riskRole(a) === 'haven'
    if (stress)
      return haven
        ? { stance: 'tailwind', reason: `VIX ${v.toFixed(1)}${zTxt}: equity stress supports haven demand` }
        : { stance: 'headwind', reason: `VIX ${v.toFixed(1)}${zTxt}: ${stressCopy(a)}` }
    if (!haven && v <= T.vixCalm) return { stance: 'tailwind', reason: `VIX ${v.toFixed(1)}: calm, risk-on backdrop` }
    return { stance: 'neutral', reason: `VIX ${v.toFixed(1)}${zTxt}: no stress signal` }
  },
})

/** HY spread: widening is a tailwind for a haven, a headwind for a cyclical asset (which also likes tightening). */
const hySpread: DriverRule = {
  id: 'BAMLH0A0HYM2',
  seriesId: 'BAMLH0A0HYM2',
  label: 'High-yield credit spread',
  rule: (a) =>
    riskRole(a) === 'haven'
      ? `3m widening ≥ +${T.hySpread3mPp}pp → tailwind (credit stress); otherwise neutral`
      : `3m widening ≥ +${T.hySpread3mPp}pp → headwind; tightening ≤ −${T.hySpread3mPp}pp → tailwind`,
  evaluate: (s, a) => {
    const c = s.change3m
    if (c == null) return noData
    const haven = riskRole(a) === 'haven'
    if (c >= T.hySpread3mPp)
      return haven
        ? { stance: 'tailwind', reason: `HY spread ${pp(c)} over 3m: credit stress building` }
        : { stance: 'headwind', reason: `HY spread ${pp(c)} over 3m: credit stress hurts cyclical demand` }
    if (!haven && c <= -T.hySpread3mPp) return { stance: 'tailwind', reason: `HY spread ${pp(c)} over 3m: credit easing` }
    return { stance: 'neutral', reason: `HY spread ${pp(c)} over 3m` }
  },
}

/**
 * Relative-value ratio (numerator / denominator) read for the pair's
 * DENOMINATOR: a high ratio means the denominator is historically cheap.
 * Silver is the denominator of gold/silver, so silver gets the GSR rule.
 */
function pairRatioDriver(p: RelativeValuePair): DriverRule {
  const num = UNIVERSE[p.numerator].label.toLowerCase()
  const den = UNIVERSE[p.denominator].label.toLowerCase()
  const id = ratioSeriesId(p)
  return {
    id,
    seriesId: id,
    label: ratioLabel(p),
    rule: () => `3y z ≥ +${T.gsrZ} → tailwind (${den} historically cheap vs ${num}); z ≤ −${T.gsrZ} → headwind (${den} rich)`,
    evaluate: (s) => {
      const z = s.z
      if (z == null || s.latest == null) return noData
      if (z >= T.gsrZ) return { stance: 'tailwind', reason: `Ratio ${s.latest.toFixed(1)}, z ${n1(z)}: ${den} cheap vs ${num}` }
      if (z <= -T.gsrZ) return { stance: 'headwind', reason: `Ratio ${s.latest.toFixed(1)}, z ${n1(z)}: ${den} rich vs ${num}` }
      return { stance: 'neutral', reason: `Ratio ${s.latest.toFixed(1)}, z ${n1(z)}: within ±${T.gsrZ}σ` }
    },
  }
}

/** Ratio drivers for every pair where the asset is the denominator. */
// The ratio rule reads a HIGH ratio as "the denominator is cheap" — a mean-
// reversion claim that holds within a class (gold/silver), not across classes
// (bitcoin/gold trends), so cross-class pairs never become scorecard drivers.
const denominatorPairDrivers = (a: AssetId): DriverRule[] =>
  RELATIVE_VALUE_PAIRS.filter((p) => p.denominator === a && UNIVERSE[p.numerator].assetClass === UNIVERSE[a].assetClass).map(pairRatioDriver)

// ── Class driver sets ──────────────────────────────────────────────────────

const PRECIOUS: DriverSet = {
  drivers: [
    realYield,
    broadDollar('metals priced in USD'),
    {
      id: 'T10YIE',
      seriesId: 'T10YIE',
      label: 'Breakeven inflation (10y)',
      rule: () => `3m change ≥ +${T.breakeven3mPp}pp → tailwind (rising inflation expectations); ≤ −${T.breakeven3mPp}pp → headwind`,
      evaluate: (s) => {
        const c = s.change3m
        if (c == null) return noData
        if (c >= T.breakeven3mPp) return { stance: 'tailwind', reason: `Breakeven ${pp(c)} over 3m: rising` }
        if (c <= -T.breakeven3mPp) return { stance: 'headwind', reason: `Breakeven ${pp(c)} over 3m: falling` }
        return { stance: 'neutral', reason: `Breakeven ${pp(c)} over 3m: within ±${T.breakeven3mPp}pp` }
      },
    },
    {
      id: 'DFF',
      seriesId: 'DFF',
      label: 'Fed funds rate',
      rule: () => `3m change ≤ −${T.fedFunds3mPp}pp → tailwind (easing); ≥ +${T.fedFunds3mPp}pp → headwind (tightening)`,
      evaluate: (s) => {
        const c = s.change3m
        if (c == null) return noData
        if (c <= -T.fedFunds3mPp) return { stance: 'tailwind', reason: `Policy rate ${pp(c)} over 3m: easing` }
        if (c >= T.fedFunds3mPp) return { stance: 'headwind', reason: `Policy rate ${pp(c)} over 3m: tightening` }
        return { stance: 'neutral', reason: `Policy rate ${pp(c)} over 3m: on hold` }
      },
    },
    {
      id: 'CPI_YOY',
      seriesId: 'CPI_YOY',
      label: 'CPI inflation (YoY)',
      rule: () => `YoY ≥ ${T.cpiHigh}% and not falling over 3m → tailwind; YoY ≤ ${T.cpiLow}% and not rising → headwind`,
      evaluate: (s) => {
        const v = s.latest
        const c = s.change3m
        if (v == null || c == null) return noData
        if (v >= T.cpiHigh && c >= 0) return { stance: 'tailwind', reason: `CPI ${v.toFixed(1)}% YoY, ${pp(c)} over 3m: hot and sticky` }
        if (v <= T.cpiLow && c <= 0) return { stance: 'headwind', reason: `CPI ${v.toFixed(1)}% YoY, ${pp(c)} over 3m: at/below target` }
        return { stance: 'neutral', reason: `CPI ${v.toFixed(1)}% YoY, ${pp(c)} over 3m` }
      },
    },
    m2Growth,
    vix(
      (a) => `${UNIVERSE[a].label.toLowerCase()} trades with industrial/risk beta`,
      (a) => `risk-off weighs on ${UNIVERSE[a].label.toLowerCase()}'s cyclical side`,
    ),
    hySpread,
  ],
  pairDrivers: denominatorPairDrivers,
  positioning: true,
}

const INDUSTRIAL: DriverSet = {
  drivers: [
    broadDollar('metals priced in USD'),
    {
      ...realYield,
      rule: () => `3m change ≤ −${T.realYield3mPp}pp → tailwind (easier financial conditions); ≥ +${T.realYield3mPp}pp → headwind`,
    },
    {
      id: 'INDPRO_YOY',
      seriesId: 'INDPRO_YOY',
      label: 'Industrial production growth (YoY)',
      rule: () => `YoY ≥ ${T.indproHigh}% → tailwind (industrial demand expanding); ≤ ${T.indproLow}% → headwind (contracting)`,
      evaluate: (s) => {
        const v = s.latest
        if (v == null) return noData
        if (v >= T.indproHigh) return { stance: 'tailwind', reason: `Industrial production ${v.toFixed(1)}% YoY: expanding` }
        if (v <= T.indproLow) return { stance: 'headwind', reason: `Industrial production ${v.toFixed(1)}% YoY: contracting` }
        return { stance: 'neutral', reason: `Industrial production ${v.toFixed(1)}% YoY: modest growth` }
      },
    },
    hySpread,
  ],
  pairDrivers: denominatorPairDrivers,
  // Copper trades on COMEX with a disaggregated COT market, so managed-money positioning applies.
  positioning: true,
}

const CRYPTO: DriverSet = {
  drivers: [
    { ...realYield, rule: () => `3m change ≤ −${T.realYield3mPp}pp → tailwind (easier liquidity, lower opportunity cost); ≥ +${T.realYield3mPp}pp → headwind` },
    broadDollar('dollar liquidity easing'),
    {
      id: 'QQQ',
      seriesId: 'QQQ',
      label: 'Nasdaq-100 momentum (QQQ)',
      rule: () => `3m change ≥ +${T.qqq3mPct * 100}% → tailwind (risk appetite); ≤ −${T.qqq3mPct * 100}% → headwind`,
      evaluate: (s) => {
        const c = s.change3m
        if (c == null) return noData
        if (c >= T.qqq3mPct) return { stance: 'tailwind', reason: `QQQ ${pc(c)} over 3m: growth risk-on` }
        if (c <= -T.qqq3mPct) return { stance: 'headwind', reason: `QQQ ${pc(c)} over 3m: growth risk-off` }
        return { stance: 'neutral', reason: `QQQ ${pc(c)} over 3m: within ±${T.qqq3mPct * 100}%` }
      },
    },
    m2Growth,
    vix(
      () => 'crypto trades as a high-beta risk asset',
      () => 'risk-off weighs on high-beta crypto',
    ),
  ],
  pairDrivers: denominatorPairDrivers,
  positioning: true,
}

export const DRIVER_SETS: Record<AssetClass, DriverSet> = {
  precious: PRECIOUS,
  industrial: INDUSTRIAL,
  crypto: CRYPTO,
}

/** The driver set that applies to an asset (by its class). */
export function driverSetFor(a: AssetId): DriverSet {
  return DRIVER_SETS[UNIVERSE[a].assetClass]
}

/** Series drivers for an asset, in display order (class drivers, then pair drivers). */
export function driversFor(a: AssetId): DriverRule[] {
  const set = driverSetFor(a)
  return [...set.drivers, ...set.pairDrivers(a)]
}

// ── COT speculator positioning ─────────────────────────────────────────────

const SPEC_ADJ: Record<CotReportFamily, { adj: string; short: string; label: string }> = {
  disagg: { adj: 'Managed-money', short: 'MM', label: 'Managed-money positioning (COT)' },
  tff: { adj: 'Leveraged-fund', short: 'LF', label: 'Leveraged-fund positioning (COT)' },
}

export function cotRule(report: CotReportFamily = 'disagg'): string {
  if (report === 'tff') {
    return 'Informational only: in CME bitcoin, leveraged funds are structurally net short because they hedge the cash-and-carry basis trade (long spot/ETFs, short futures), so their net position is not read as a directional contrarian signal'
  }
  return `${SPEC_ADJ[report].adj} net % of open interest, 3y percentile ≥ ${T.cotCrowded * 100}th → headwind (crowded long, contrarian); ≤ ${T.cotWashed * 100}th → tailwind (positioning washed out)`
}

export function cotStance(p: CotPoint | null, report: CotReportFamily = 'disagg'): RuleResult {
  if (!p || p.specPercentile3y == null || p.specNetPctOi == null) return noData
  const pct = ordinal(Math.round(p.specPercentile3y * 100))
  const txt = `${SPEC_ADJ[report].short} net ${n1(p.specNetPctOi * 100)}% of OI, ${pct} pct (3y)`
  if (report === 'tff') {
    const side = p.specNetPctOi < 0 ? 'net short, mostly basis-trade hedges' : 'net long'
    return { stance: 'neutral', reason: `${txt}: ${side}; not a directional signal` }
  }
  if (p.specPercentile3y >= T.cotCrowded) return { stance: 'headwind', reason: `${txt}: crowded long` }
  if (p.specPercentile3y <= T.cotWashed) return { stance: 'tailwind', reason: `${txt}: washed out` }
  return { stance: 'neutral', reason: `${txt}` }
}

/** Build the per-asset scorecard from series snapshots and the asset's latest COT point. PURE. */
export function buildScorecard(asset: AssetId, series: Map<string, MacroSeriesSnapshot>, cot: CotPoint | null): ScorecardRow[] {
  const rows: ScorecardRow[] = []
  for (const d of driversFor(asset)) {
    const s = series.get(d.seriesId)
    const r = s ? d.evaluate(s, asset) : noData
    rows.push({
      id: d.id,
      label: d.label,
      seriesId: d.seriesId,
      value: s?.latest ?? null,
      unit: s?.unit ?? 'index',
      changeKind: s?.changeKind ?? 'diff',
      change1m: s?.change1m ?? null,
      change3m: s?.change3m ?? null,
      z: s?.z ?? null,
      stance: r.stance,
      reason: r.reason,
      rule: d.rule(asset),
      asOf: s?.latestDate ?? null,
    })
  }
  const cotSpec = UNIVERSE[asset].cot
  if (driverSetFor(asset).positioning && cotSpec) {
    const report = cotSpec.report
    const driverId = speculatorOf(report).driverId
    const c = cotStance(cot, report)
    rows.push({
      id: driverId,
      label: SPEC_ADJ[report].label,
      seriesId: driverId,
      value: cot?.specNetPctOi != null ? cot.specNetPctOi * 100 : null,
      unit: 'percent',
      changeKind: 'diff',
      change1m: null,
      change3m: null,
      z: cot?.specZ3y ?? null,
      stance: c.stance,
      reason: c.reason,
      rule: cotRule(report),
      asOf: cot?.reportDate ?? null,
    })
  }
  return rows
}

/**
 * Regime label from three explicit reads:
 *  - real yields: DFII10 3m change beyond ±0.15pp → falling/rising, else stable;
 *  - dollar: broad dollar (fallback DXY) 3m change beyond ±1.5% → weakening/strengthening, else stable;
 *  - risk: VIX ≥ 22 or HY-spread 3y z ≥ 1 → risk-off; VIX ≤ 15 and HY z ≤ 0 → risk-on; else mixed.
 * Part stances are expressed for the given asset (risk by its haven/cyclical role). PURE.
 */
export function buildRegime(asset: AssetId, series: Map<string, MacroSeriesSnapshot>): MacroRegime {
  const parts: RegimePart[] = []
  const ry = series.get('DFII10')?.change3m
  if (ry == null) parts.push({ key: 'realYields', label: 'Real yields n/a', stance: 'neutral' })
  else if (ry <= -T.realYield3mPp) parts.push({ key: 'realYields', label: 'Real yields falling', stance: 'tailwind' })
  else if (ry >= T.realYield3mPp) parts.push({ key: 'realYields', label: 'Real yields rising', stance: 'headwind' })
  else parts.push({ key: 'realYields', label: 'Real yields stable', stance: 'neutral' })

  const usd = series.get('DTWEXBGS')?.change3m ?? series.get('DXY')?.change3m
  if (usd == null) parts.push({ key: 'dollar', label: 'Dollar n/a', stance: 'neutral' })
  else if (usd <= -T.dollar3mPct) parts.push({ key: 'dollar', label: 'Dollar weakening', stance: 'tailwind' })
  else if (usd >= T.dollar3mPct) parts.push({ key: 'dollar', label: 'Dollar strengthening', stance: 'headwind' })
  else parts.push({ key: 'dollar', label: 'Dollar stable', stance: 'neutral' })

  const haven = riskRole(asset) === 'haven'
  const vixNow = series.get('VIXCLS')?.latest
  const hyZ = series.get('BAMLH0A0HYM2')?.z
  if (vixNow == null) parts.push({ key: 'risk', label: 'Risk n/a', stance: 'neutral' })
  else if (vixNow >= T.riskOffVix || (hyZ != null && hyZ >= T.hyZRiskOff))
    parts.push({ key: 'risk', label: 'Risk-off', stance: haven ? 'tailwind' : 'headwind' })
  else if (vixNow <= T.riskOnVix && (hyZ == null || hyZ <= 0))
    parts.push({ key: 'risk', label: 'Risk-on', stance: haven ? 'neutral' : 'tailwind' })
  else parts.push({ key: 'risk', label: 'Risk mixed', stance: 'neutral' })

  return { label: parts.map((p) => p.label).join(' · '), parts }
}
