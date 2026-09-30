import type { Metal } from '../../shared/universe.js'
import type { CotPoint, MacroRegime, MacroSeriesSnapshot, RegimePart, ScorecardRow, Stance } from '../../shared/macro.js'

// Transparent macro scorecard. Every driver maps its current reading to a
// stance for the metal through an explicit, documented threshold rule. The
// rules are deliberately simple and symmetric so a reader can verify them by
// hand from the numbers shown next to each row. Changes are 3-month changes
// (latest vs the observation on/before the same date three months earlier).

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
} as const

const T = THRESHOLDS
const pp = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}pp`
export function ordinal(n: number): string {
  const r100 = n % 100
  const s = r100 >= 11 && r100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${s}`
}
const pc = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`

interface RuleResult {
  stance: Stance
  reason: string
}

interface DriverRule {
  id: string
  seriesId: string
  label: string
  metals: Metal[]
  rule: (m: Metal) => string
  evaluate: (s: MacroSeriesSnapshot, m: Metal) => RuleResult
}

const noData: RuleResult = { stance: 'neutral', reason: 'Insufficient data' }

const DRIVERS: DriverRule[] = [
  {
    id: 'DFII10',
    seriesId: 'DFII10',
    label: 'Real yield (10y TIPS)',
    metals: ['gold', 'silver'],
    rule: () => `3m change ≤ −${T.realYield3mPp}pp → tailwind (lower opportunity cost); ≥ +${T.realYield3mPp}pp → headwind`,
    evaluate: (s) => {
      const c = s.change3m
      if (c == null) return noData
      if (c <= -T.realYield3mPp) return { stance: 'tailwind', reason: `Real yield ${pp(c)} over 3m: falling` }
      if (c >= T.realYield3mPp) return { stance: 'headwind', reason: `Real yield ${pp(c)} over 3m: rising` }
      return { stance: 'neutral', reason: `Real yield ${pp(c)} over 3m: within ±${T.realYield3mPp}pp` }
    },
  },
  {
    id: 'DTWEXBGS',
    seriesId: 'DTWEXBGS',
    label: 'Broad dollar',
    metals: ['gold', 'silver'],
    rule: () => `3m change ≤ −${T.dollar3mPct * 100}% → tailwind (metals priced in USD); ≥ +${T.dollar3mPct * 100}% → headwind`,
    evaluate: (s) => {
      const c = s.change3m
      if (c == null) return noData
      if (c <= -T.dollar3mPct) return { stance: 'tailwind', reason: `Dollar ${pc(c)} over 3m: weakening` }
      if (c >= T.dollar3mPct) return { stance: 'headwind', reason: `Dollar ${pc(c)} over 3m: strengthening` }
      return { stance: 'neutral', reason: `Dollar ${pc(c)} over 3m: within ±${T.dollar3mPct * 100}%` }
    },
  },
  {
    id: 'T10YIE',
    seriesId: 'T10YIE',
    label: 'Breakeven inflation (10y)',
    metals: ['gold', 'silver'],
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
    metals: ['gold', 'silver'],
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
    metals: ['gold', 'silver'],
    rule: () =>
      `YoY ≥ ${T.cpiHigh}% and not falling over 3m → tailwind; YoY ≤ ${T.cpiLow}% and not rising → headwind`,
    evaluate: (s) => {
      const v = s.latest
      const c = s.change3m
      if (v == null || c == null) return noData
      if (v >= T.cpiHigh && c >= 0) return { stance: 'tailwind', reason: `CPI ${v.toFixed(1)}% YoY, ${pp(c)} over 3m: hot and sticky` }
      if (v <= T.cpiLow && c <= 0) return { stance: 'headwind', reason: `CPI ${v.toFixed(1)}% YoY, ${pp(c)} over 3m: at/below target` }
      return { stance: 'neutral', reason: `CPI ${v.toFixed(1)}% YoY, ${pp(c)} over 3m` }
    },
  },
  {
    id: 'M2_YOY',
    seriesId: 'M2_YOY',
    label: 'M2 money growth (YoY)',
    metals: ['gold', 'silver'],
    rule: () => `YoY ≥ ${T.m2High}% → tailwind (monetary expansion); ≤ ${T.m2Low}% → headwind (contraction)`,
    evaluate: (s) => {
      const v = s.latest
      if (v == null) return noData
      if (v >= T.m2High) return { stance: 'tailwind', reason: `M2 ${v.toFixed(1)}% YoY: expanding fast` }
      if (v <= T.m2Low) return { stance: 'headwind', reason: `M2 ${v.toFixed(1)}% YoY: contracting` }
      return { stance: 'neutral', reason: `M2 ${v.toFixed(1)}% YoY: moderate` }
    },
  },
  {
    id: 'VIXCLS',
    seriesId: 'VIXCLS',
    label: 'Equity volatility (VIX)',
    metals: ['gold', 'silver'],
    rule: (m) =>
      m === 'gold'
        ? `VIX ≥ ${T.vixStress} or 3y z ≥ ${T.vixZStress} → tailwind (safe-haven demand); otherwise neutral`
        : `VIX ≥ ${T.vixStress} or 3y z ≥ ${T.vixZStress} → headwind (silver trades with industrial/risk beta); VIX ≤ ${T.vixCalm} → tailwind`,
    evaluate: (s, m) => {
      const v = s.latest
      if (v == null) return noData
      const stress = v >= T.vixStress || (s.z != null && s.z >= T.vixZStress)
      const zTxt = s.z != null ? `, z ${s.z.toFixed(1)}` : ''
      if (stress)
        return m === 'gold'
          ? { stance: 'tailwind', reason: `VIX ${v.toFixed(1)}${zTxt}: equity stress supports haven demand` }
          : { stance: 'headwind', reason: `VIX ${v.toFixed(1)}${zTxt}: risk-off weighs on silver's cyclical side` }
      if (m === 'silver' && v <= T.vixCalm) return { stance: 'tailwind', reason: `VIX ${v.toFixed(1)}: calm, risk-on backdrop` }
      return { stance: 'neutral', reason: `VIX ${v.toFixed(1)}${zTxt}: no stress signal` }
    },
  },
  {
    id: 'BAMLH0A0HYM2',
    seriesId: 'BAMLH0A0HYM2',
    label: 'High-yield credit spread',
    metals: ['gold', 'silver'],
    rule: (m) =>
      m === 'gold'
        ? `3m widening ≥ +${T.hySpread3mPp}pp → tailwind (credit stress); otherwise neutral`
        : `3m widening ≥ +${T.hySpread3mPp}pp → headwind; tightening ≤ −${T.hySpread3mPp}pp → tailwind`,
    evaluate: (s, m) => {
      const c = s.change3m
      if (c == null) return noData
      if (c >= T.hySpread3mPp)
        return m === 'gold'
          ? { stance: 'tailwind', reason: `HY spread ${pp(c)} over 3m: credit stress building` }
          : { stance: 'headwind', reason: `HY spread ${pp(c)} over 3m: credit stress hurts cyclical demand` }
      if (m === 'silver' && c <= -T.hySpread3mPp) return { stance: 'tailwind', reason: `HY spread ${pp(c)} over 3m: credit easing` }
      return { stance: 'neutral', reason: `HY spread ${pp(c)} over 3m` }
    },
  },
  {
    id: 'GSR',
    seriesId: 'GSR',
    label: 'Gold/silver ratio',
    metals: ['silver'],
    rule: () => `3y z ≥ +${T.gsrZ} → tailwind (silver historically cheap vs gold); z ≤ −${T.gsrZ} → headwind (silver rich)`,
    evaluate: (s) => {
      const z = s.z
      if (z == null || s.latest == null) return noData
      if (z >= T.gsrZ) return { stance: 'tailwind', reason: `Ratio ${s.latest.toFixed(1)}, z ${z.toFixed(1)}: silver cheap vs gold` }
      if (z <= -T.gsrZ) return { stance: 'headwind', reason: `Ratio ${s.latest.toFixed(1)}, z ${z.toFixed(1)}: silver rich vs gold` }
      return { stance: 'neutral', reason: `Ratio ${s.latest.toFixed(1)}, z ${z.toFixed(1)}: within ±${T.gsrZ}σ` }
    },
  },
]

export const COT_RULE = `Managed-money net % of open interest, 3y percentile ≥ ${T.cotCrowded * 100}th → headwind (crowded long, contrarian); ≤ ${T.cotWashed * 100}th → tailwind (positioning washed out)`

export function cotStance(p: CotPoint | null): RuleResult {
  if (!p || p.mmPercentile3y == null || p.mmNetPctOi == null) return noData
  const pct = ordinal(Math.round(p.mmPercentile3y * 100))
  const txt = `MM net ${(p.mmNetPctOi * 100).toFixed(1)}% of OI, ${pct} pct (3y)`
  if (p.mmPercentile3y >= T.cotCrowded) return { stance: 'headwind', reason: `${txt}: crowded long` }
  if (p.mmPercentile3y <= T.cotWashed) return { stance: 'tailwind', reason: `${txt}: washed out` }
  return { stance: 'neutral', reason: `${txt}` }
}

/** Build the per-metal scorecard from series snapshots and the metal's latest COT point. PURE. */
export function buildScorecard(metal: Metal, series: Map<string, MacroSeriesSnapshot>, cot: CotPoint | null): ScorecardRow[] {
  const rows: ScorecardRow[] = []
  for (const d of DRIVERS) {
    if (!d.metals.includes(metal)) continue
    const s = series.get(d.seriesId)
    const r = s ? d.evaluate(s, metal) : noData
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
      rule: d.rule(metal),
      asOf: s?.latestDate ?? null,
    })
  }
  const c = cotStance(cot)
  rows.push({
    id: 'COT_MM',
    label: 'Managed-money positioning (COT)',
    seriesId: 'COT_MM',
    value: cot?.mmNetPctOi != null ? cot.mmNetPctOi * 100 : null,
    unit: 'percent',
    changeKind: 'diff',
    change1m: null,
    change3m: null,
    z: cot?.mmZ3y ?? null,
    stance: c.stance,
    reason: c.reason,
    rule: COT_RULE,
    asOf: cot?.reportDate ?? null,
  })
  return rows
}

/**
 * Regime label from three explicit reads:
 *  - real yields: DFII10 3m change beyond ±0.15pp → falling/rising, else stable;
 *  - dollar: broad dollar (fallback DXY) 3m change beyond ±1.5% → weakening/strengthening, else stable;
 *  - risk: VIX ≥ 22 or HY-spread 3y z ≥ 1 → risk-off; VIX ≤ 15 and HY z ≤ 0 → risk-on; else mixed.
 * Part stances are expressed for the given metal. PURE.
 */
export function buildRegime(metal: Metal, series: Map<string, MacroSeriesSnapshot>): MacroRegime {
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

  const vix = series.get('VIXCLS')?.latest
  const hyZ = series.get('BAMLH0A0HYM2')?.z
  if (vix == null) parts.push({ key: 'risk', label: 'Risk n/a', stance: 'neutral' })
  else if (vix >= T.riskOffVix || (hyZ != null && hyZ >= T.hyZRiskOff))
    parts.push({ key: 'risk', label: 'Risk-off', stance: metal === 'gold' ? 'tailwind' : 'headwind' })
  else if (vix <= T.riskOnVix && (hyZ == null || hyZ <= 0))
    parts.push({ key: 'risk', label: 'Risk-on', stance: metal === 'gold' ? 'neutral' : 'tailwind' })
  else parts.push({ key: 'risk', label: 'Risk mixed', stance: 'neutral' })

  return { label: parts.map((p) => p.label).join(' · '), parts }
}
