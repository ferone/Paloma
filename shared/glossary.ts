// The platform's glossary: one source for the "How to read this" explainers in
// the UI and for the AI assistant's retrieval corpus. Bodies use a tiny markup
// subset (paragraphs separated by a blank line, **bold**, *italic*) and state the
// engine's exact rules, so the assistant teaches what the app actually does.
//
// `body` is what the on-page explainer shows; `more` is extra detail only the
// assistant sees. `pages` are route prefixes where the term is on screen.
// Template placeholders like {num} are filled by `fillGlossary`.

import { MONTH_CODES, RELATIVE_VALUE_PAIRS, UNIVERSE, ASSETS } from './universe.js'

export interface GlossaryEntry {
  id: string
  term: string
  /** Lower-case phrases a user might type for this concept. */
  aliases: string[]
  /** Heading of the on-page explainer (defaults to `term`). */
  title?: string
  /** One-sentence definition. */
  short: string
  /** Paragraphs shown on the page (and given to the assistant). */
  body: string
  /** Assistant-only extra detail. */
  more?: string
  /** Route prefixes where this term appears. */
  pages: string[]
  related: string[]
}

const p = (...paras: string[]) => paras.join('\n\n')

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "F Jan · G Feb · …" built from the universe's month codes. */
const MONTH_TABLE = MONTH_CODES.map((c, i) => `${c} ${MONTH_NAMES[i]}`).join(' · ')

/** One line per futures product: root, exchange, size, point value, active months. Built from the universe. */
const PRODUCT_LINES = ASSETS.flatMap((a) =>
  UNIVERSE[a].futures.map(
    (f) =>
      `- **${f.root}** (${f.name}, ${f.exchange}): ${f.contractSize.toLocaleString('en-US')} ${UNIVERSE[a].priceUnit} per contract, $${f.pointValue.toLocaleString('en-US')} per 1.00 move in ${UNIVERSE[a].unitLabel}, ${f.cashSettled ? 'cash-settled' : 'physically delivered'}; active months ${f.activeMonths.map((m) => `${MONTH_CODES[m - 1]} (${MONTH_NAMES[m - 1]})`).join(', ')}.`,
  ),
).join('\n')

const PAIR_LINES = RELATIVE_VALUE_PAIRS.map((r) => `${r.id} = ${r.label.toLowerCase()}`).join(', ')

export const GLOSSARY: GlossaryEntry[] = [
  // ── Quant Lab: the explainers shown on the pages ────────────────────────
  {
    id: 'zscore',
    term: 'z-score',
    title: 'What is the z-score?',
    aliases: ['z-score', 'z score', 'zscore', 'z', 'effective z', 'eff. z', 'eff z', 'zeff', 'stretch', 'standard deviation', 'sigma', 'fade'],
    short: 'How many standard deviations today’s value sits from its own 60-day mean; the engine fades the stretch.',
    body: p(
      'The z-score says how far today’s value sits from its own recent average, in standard deviations: (value − 60-day mean) ÷ 60-day σ. A z of +2 means the spread is unusually high; −2 unusually low.',
      'The engine **fades** the stretch: z > 0 ⇒ short the structure, z < 0 ⇒ long it. The score (0–100) rises with |z| and is damped when seasonality disagrees or volatility is blowing up. *Effective z* uses a lookback sized to the spread’s own half-life instead of 60 days.',
    ),
    more: p(
      'The window ends today and includes today, so the z is causal (no look-ahead). With fewer than 60 observations there is no score. z near 0 means no edge. The z is computed on the structure’s own value series (the spread, fly, ratio or basis level), not on returns.',
      'Score base = 100 ÷ (1 + e^(−2·(|z| − 1.5))): about 27 at |z| = 1, 50 at 1.5, 73 at 2, 88 at 2.5, 95 at 3. Seasonality, fundamentals and a volatility dampener then multiply it (each context factor maps to a 0.5–1.2 envelope).',
    ),
    pages: ['/quant'],
    related: ['tiers', 'ou', 'qt-rank'],
  },
  {
    id: 'ou',
    term: 'OU half-life',
    title: 'What is the OU half-life?',
    aliases: ['ou', 'o-u', 'ornstein', 'ornstein-uhlenbeck', 'half-life', 'half life', 'halflife', 'ou fail', 'ou failed', 'ou gate', 'ou pass', 'mean reversion', 'mean-reversion', 'tradable', 'tradability', 'b coefficient', 'ar(1)', 'microstructure noise'],
    short: 'An Ornstein–Uhlenbeck fit of the structure; tradable only when 0 < b < 1 and the half-life is 5–60 trading days.',
    body: p(
      'An Ornstein–Uhlenbeck fit treats the spread as a rubber band: x(t+1) = a + b·x(t). The **half-life** ln 2 ÷ (−ln b) is how many trading days it takes, on average, for half of a deviation to disappear.',
      'Tradable only between 5 and 60 days: faster is microstructure noise, slower won’t converge within the holding horizon, and b ≥ 1 means there is no pull back at all (a random walk). Failing this gate damps the rank and blocks a conservative BUY.',
    ),
    more: p(
      '**"OU fail"** means the gate is not met, for one of four exact reasons the app prints: "insufficient data for an OU fit"; "no mean-reversion structure (AR(1) b ≥ 1 — trending/random walk)"; "half-life X d < 5d — microstructure noise, not a tradable reversion" (b close to 0: the series jumps around its mean day to day, typically roll noise or bid/ask bounce in a thin structure, so there is nothing to wait for); or "half-life X d > 60d — too slow to converge within the holding horizon".',
      'Consequences: the QT rank is multiplied by the gate damp (0.25) and the tradability bonus is 0; in conservative mode the verdict gets the blocker "no mean-reversion structure (OU half-life out of bounds) — the z-fade has no engine". Aggressive mode still shows the signal but lists the gate as context. When OU passes, the tradability bonus is up to 25 points, larger for a shorter half-life within the band, and *expected days* ≈ the time for the current deviation to decay to the target.',
    ),
    pages: ['/quant'],
    related: ['zscore', 'qt-rank', 'verdict', 'structural'],
  },
  {
    id: 'carry',
    term: 'Contango, backwardation and carry',
    title: 'Contango, backwardation and carry',
    aliases: ['contango', 'backwardation', 'carry', 'carry gate', 'carry veto', 'carry conflict', 'trending veto', 'trending', 'slope momentum', 'curve slope', 'lease rate', 'term structure', 'roll yield', 'aligned', 'conflict'],
    short: 'Contango = deferreds above the front (normal for storable assets); backwardation = front above deferreds (scarcity). A trending slope vetoes fading a calendar.',
    body: p(
      '**Contango**: deferred contracts trade above the front, the normal state for storable assets such as gold and silver because holding them costs interest and storage. **Backwardation**: the front trades above deferreds, a sign of immediate scarcity (tight lease market, delivery squeeze).',
      'Annualized carry = (deferred ÷ front − 1) ÷ years between expiries; for gold it tracks short-term USD rates minus the gold lease rate. The engine vetoes fading a calendar when the curve slope itself is trending (momentum z ≥ 2).',
    ),
    more: p(
      'The carry read is built from the stored structures (c0 = front outright, c1 = c0 − cal01, c2 = fly + c0 − 2·cal01). It is a gate and a corroboration, never a score multiplier: *aligned* (the curve supports the fade, e.g. a rich calendar while the slope sits in its bottom quintile over ~3 years) adds a carry bonus of 15 to the QT rank; *conflict* means the slope is trending (20-day slope momentum |z| ≥ 2), which vetoes a conservative BUY with "carry veto: the curve slope is trending — don’t fade a trending curve" and damps the rank. The veto applies to calendars only.',
      'For bitcoin futures (cash-settled, no storage) the curve’s carry is mostly a funding/demand premium rather than storage cost.',
    ),
    pages: ['/quant', '/markets/curve'],
    related: ['calendar', 'basis', 'structural'],
  },
  {
    id: 'butterfly',
    term: 'Butterfly',
    title: 'What is a butterfly?',
    aliases: ['butterfly', 'fly', 'flies', 'butterflies', 'curvature', 'bow', 'wings', 'body', 'c0 − 2·c1 + c2', 'c0-2c1+c2', '1:-2:1', 'buy the fly', 'sell the fly', 'mariposa'],
    short: 'Long the front and back months, short twice the middle: c0 − 2·c1 + c2. It isolates curve shape.',
    body: p(
      'A butterfly is long the front and back months and short twice the middle: c0 − 2·c1 + c2. On a smooth carry curve the middle month sits on the straight line between the wings, so the fly is near zero; its value is −2 × the middle month’s **bow** off that line.',
      'It isolates curve shape from price level and from the overall slope, so it is usually the cleanest mean-reversion structure — unless the curve is being structurally repriced (the regime gate below).',
    ),
    more: p(
      'Legs are 1 : −2 : 1. **Buying (going long) the fly** = buy 1 front (wing), sell 2 middle (body), buy 1 back (wing): it profits when the value c0 − 2·c1 + c2 rises, i.e. the middle month cheapens relative to the wings. **Selling (shorting) the fly** = sell 1 front, buy 2 middle, sell 1 back: it profits when the value falls. The engine fades the z: a rich fly (z > 0) is a SELL, a cheap one (z < 0) a BUY.',
      'Dollar P&L per fly = change in fly value × the product’s point value (e.g. $100 per $1/oz for GC). Because the wings and body offset each other, a fly has little outright price exposure; its risks are curve-shape shocks (delivery squeezes, lease-rate spikes, a flip into backwardation), legging slippage, and the fact that the body is often less liquid than the front.',
      'Curvature (shown for flies) = mid − average of the wings, the bow itself.',
    ),
    pages: ['/quant'],
    related: ['spread-execution', 'calendar', 'structural', 'month-codes'],
  },
  {
    id: 'structural',
    term: 'Structural-move gate',
    title: 'What is the structural-move gate?',
    aliases: ['structural', 'structural move', 'structural gate', 'structural pass', 'structural fail', 'structural-move', 'regime-off', 'regime off', 'regime gate', 'noise band', 'breakout'],
    short: 'Blocks fading a structure when the front outright or the curve slope is more than 2.5σ outside its 60-day noise band.',
    body: p(
      'Spreads bend for real reasons too: a squeeze, a rate shock, a flip into backwardation. The gate measures how many σ the front outright and the curve slope are from their own 60-day noise bands. Beyond ±2.5σ the move is treated as structural and fading it is blocked (“regime-off”).',
    ),
    more: p(
      '**Structural pass** (gate shows no structural move) = both monitored series are inside ±2.5σ, so a mean-reversion trade is allowed. **Structural fail / regime-off** = at least one is outside, so the conservative verdict adds the blocker "regime-OFF — the current period is itself in a structural move (breaking its own noise band); stand aside until it normalizes" and the QT rank is damped (× 0.25). A series with too little history is treated as not structural. The gate applies to butterflies and outrights; null means not applicable.',
    ),
    pages: ['/quant'],
    related: ['butterfly', 'regimes', 'ou'],
  },
  {
    id: 'seasonality',
    term: 'Seasonality',
    title: 'How to read the seasonality',
    aliases: ['seasonality', 'seasonal', 'seasonal window', 'season', 'envelope', 'roll-clean', 'roll clean', 'seasonal pair', 'day of year'],
    short: 'Day-of-year behaviour across past seasons; a window is trusted only after the walk-forward out-of-sample test passes.',
    body: p(
      'The shaded envelope shows, for each day of the year, where the value sat across past years (10–90% and 25–75% ranges); the solid line is the average and the coloured line is this season. Outrights and the ratio are rebased to % change from each season’s start; spreads are shown in the product’s price unit ($/oz for the metals).',
      'Roll-clean pair spreads (e.g. gold Jun–Aug) are rebuilt from the same two contract months every year, so there is no roll splice. Their contract window starts nine months before the front month, so the axis starts where each season starts. Windows are searched on **prior seasons only**, and a window only earns trust when the walk-forward test (pick the window on past years, trade it blind on the next) passes: ≥ 3 out-of-sample years, ≥ 60% wins, positive average, |t| ≥ 1.5.',
    ),
    more: p(
      'Seasonal instruments have ids like GC.seas.M-Q (gold June–August pair, M and Q are month codes). For them the base of the QT rank is 50·min(1, |t|/3) + 20 if out-of-sample passed. The conservative verdict buys a validated window only while inside it ("outside the validated seasonal window — wait for the entry date" otherwise).',
    ),
    pages: ['/quant/seasonality', '/quant'],
    related: ['oos', 'month-codes', 'calendar'],
  },
  {
    id: 'ratio',
    term: 'Ratio trade',
    title: 'The {n}/{d} ratio',
    aliases: ['ratio', 'ratio trade', 'gold/silver', 'gold silver ratio', 'gold-silver', 'gold/platinum', 'palladium/platinum', 'copper/gold', 'bitcoin/gold', 'btc/gold', 'relative value', 'pair trade', 'dollar-neutral', 'dollar neutral', 'hedge ratio', 'vol parity'],
    short: 'Units of the denominator one unit of the numerator buys; traded as a dollar-neutral long/short pair of futures.',
    body: p(
      'Units of {d} one unit of {n} buys ({numRoot} front ÷ {denRoot} front). A high ratio means {d} is cheap relative to {n}. Trading it means a dollar-neutral pair: long $X of {n} and short $X of {d} (or the reverse), sized with the hedge ratio shown.',
      'Bands are the 252-day mean ± 1σ / ± 2σ. The OU half-life of a ratio is usually long — relative value between assets reverts over months, not days — which the gate flags.',
    ),
    more: p(
      `Pairs configured in this platform: ${PAIR_LINES}. Instrument ids are <pair>.ratio and <pair>.spread (e.g. GS.ratio).`,
      'Dollar-neutral sizing uses each product’s point value: notional of one contract = price × point value. Denominator contracts per 1 numerator contract = (numerator price × numerator point value) ÷ (denominator price × denominator point value). Example shape: if one gold contract is worth about the same as N silver contracts, long 1 GC / short N SI is long the gold/silver ratio. Selling the ratio is the reverse. The page also shows a volatility-parity alternative (equal trailing dollar volatility). Micro contracts help get the ratio close to neutral.',
    ),
    pages: ['/quant/relative-value', '/markets'],
    related: ['ou', 'zscore', 'month-codes'],
  },
  {
    id: 'backtest',
    term: 'Backtest',
    title: 'How the backtest works',
    aliases: ['backtest', 'back-test', 'point-in-time', 'replay', 'simulation', 'baseline', 'selection value'],
    short: 'A monthly point-in-time replay of the verdict over ten years, risk-equalized and net of costs.',
    body: p(
      'A point-in-time replay: roughly once a month for the last ten years, the engine is rebuilt with only the data available on that date — including an out-of-sample status computed from completed prior years — and asked for its verdict. The outcome 20 sessions later is booked, risk-equalized so a 1σ favourable move ≈ $1,000, less $30 costs.',
      '**Model** books only its BUY/SELL verdicts; the **baseline** fades every stretch. The gap is the verdict’s selection value. It is an illustration, not a promise: overlapping holding periods and one path of history.',
    ),
    pages: ['/quant/backtest'],
    related: ['verdict', 'oos'],
  },
  {
    id: 'verdict',
    term: 'Verdict modes',
    title: 'Conservative vs aggressive',
    aliases: ['verdict', 'conservative', 'aggressive', 'mode', 'buy', 'sell', 'avoid', 'stand aside', 'blocker', 'blockers', 'reasons', 'why verdict', 'instruction'],
    short: 'Conservative acts only on validated, gated edges; aggressive acts on the live signal (score ≥ WATCH, no AVOID override).',
    body: p(
      '**Conservative** acts only on an edge that passed walk-forward out-of-sample testing, scores ≥ MODERATE, has no AVOID override, is not regime-fragile, has an OU half-life in bounds, no carry veto and no structural move in progress. **Aggressive** acts on the live signal (score ≥ WATCH, no AVOID override) and shows OOS, ML and the gates as context.',
      'BUY = go long the structure, SELL = go short it; the legs are named with the real contracts. Advisory only — nothing is executed.',
    ),
    more: p(
      'Direction comes from the fade (z > 0 ⇒ short, z < 0 ⇒ long) or, for seasonal pairs, from the validated window’s side. Each verdict lists reasons (conditions met) and blockers (conditions failed); a single blocker makes the conservative verdict AVOID. The verdict mode is the toggle at the top of the Quant Lab.',
    ),
    pages: ['/quant'],
    related: ['tiers', 'qt-rank', 'oos', 'ou', 'structural', 'carry'],
  },
  {
    id: 'kelly',
    term: 'Half-Kelly sizing',
    title: 'Half-Kelly sizing (illustrative)',
    aliases: ['kelly', 'half-kelly', 'half kelly', 'position size', 'sizing', 'how many contracts'],
    short: 'f* = p − (1 − p) ÷ b from out-of-sample stats; the app suggests half of it, capped at 25% of the sleeve’s risk capital.',
    body: p(
      'Kelly f* = p − (1 − p) ÷ b, with p the out-of-sample win rate and b the average win ÷ average loss. Full Kelly is famously aggressive and the inputs are noisy with a handful of trades, so the suggestion is half of it, capped at 25% of the risk capital you allocate to this sleeve. Treat it as an upper bound, not a recommendation.',
    ),
    pages: ['/quant'],
    related: ['oos', 'verdict'],
  },

  // ── Quant Lab: assistant-only concepts ──────────────────────────────────
  {
    id: 'qt-rank',
    term: 'QT rank',
    aliases: ['qt rank', 'qtrank', 'rank', 'ranking', 'composite rank', 'scanner rank', 'gate damp', 'gatedamp', 'tradability bonus', 'oos boost', 'ml boost', 'carry boost'],
    short: 'The scanner’s transparent composite: (base + tradability + carry boost + OOS boost + ML boost) × 0.25 if any gate failed.',
    body: p(
      'qtRank = (base + tradability + carryBoost + oosBoost + mlBoost) · (any gate failed ? 0.25 : 1). Gates damp a rank, they never hide an instrument: the scanner shows everything and the verdict decides trade or no trade.',
      '- **base**: the convergence score (0–100); for seasonal pairs 50·min(1, |t|/3) + 20 if out-of-sample passed.\n- **tradability**: up to 25 when the OU gate passes, 25·(1 − (half-life − 5)/(60 − 5)), so shorter in-band half-lives score more; 0 when OU fails.\n- **carryBoost**: +15 when the carry read is aligned with the trade.\n- **oosBoost**: up to +20 when walk-forward passed (20·min(1, Sharpe)), halved if the edge is regime-fragile.\n- **mlBoost**: (p(converge) − 0.5)·40 only when the ML model is validated; otherwise 0.\n- **gates**: OU, carry veto and structural move; any failure multiplies the total by 0.25.',
      'The weights are fixed documented constants, never fitted to P&L.',
    ),
    pages: ['/quant'],
    related: ['tiers', 'ou', 'carry', 'structural', 'oos', 'ml-gate'],
  },
  {
    id: 'tiers',
    term: 'Score tiers',
    aliases: ['tier', 'tiers', 'strong', 'moderate', 'watch', 'avoid override', 'convergence score', 'score', 'season factor', 'fund factor'],
    short: 'STRONG ≥ 70, MODERATE 45–70, WATCH 25–45, AVOID below 25 or when the AVOID override fires.',
    body: p(
      'The convergence score (0–100) maps to tiers: **STRONG** ≥ 70, **MODERATE** 45–70, **WATCH** 25–45, **AVOID** < 25.',
      'The **AVOID override** is checked first: if the seasonal factor and the fundamental factor are both below −0.25 (the stretch runs with the calendar and is fundamentally justified), the tier is AVOID whatever the score. It is the trap the engine refuses: a big deviation everything else says should be there.',
      'Score = base(|z|) × season multiplier × fundamental multiplier (× a volatility dampener), clamped to 0–100. Each factor in [−1, 1] maps to a multiplier from 0.5 (disagrees) through 0.85 (neutral) to 1.2 (agrees). The score is conviction in reversion, not a price forecast and not a backtested return.',
    ),
    pages: ['/quant'],
    related: ['zscore', 'verdict', 'qt-rank'],
  },
  {
    id: 'oos',
    term: 'Walk-forward out-of-sample (OOS) validation',
    aliases: ['oos', 'out-of-sample', 'out of sample', 'walk-forward', 'walk forward', 'oos pass', 'oos passed', 'oos failed', 'untested', 'validated', 't-stat', 't stat', 'win rate', 'regime-fragile', 'regime fragile', 'regime-robust', 'regime robust'],
    short: 'Pick on the past, trade blind on the next year; passes with ≥ 3 trades/years, win rate ≥ 60%, average > 0 and |t| ≥ 1.5.',
    body: p(
      'For each test year the rule (a seasonal window, or the z-fade) is chosen using only prior years, then applied unchanged to the unseen year, net of costs. The trades are pooled into win rate, average P&L, Sharpe and t-stat.',
      'An instrument **passes** with at least 3 out-of-sample trades, a win rate ≥ 60%, a positive average and |t| ≥ 1.5. **Failed** = tested but below the bar; **untested** = not enough history. A 100% in-sample win rate can still fail on too few independent years. The gate is necessary, not sufficient: some instruments pass by chance across a large scan.',
      '**Regime robustness**: the same bar is re-applied after dropping trades that entered during documented shock windows. A passed edge that collapses is flagged **regime-fragile** (conservative mode then abstains, and the OOS boost to the rank is halved); otherwise **regime-robust**. This diagnostic never changes the headline status.',
    ),
    pages: ['/quant'],
    related: ['seasonality', 'regimes', 'verdict', 'kelly'],
  },
  {
    id: 'regimes',
    term: 'Regimes and shock years',
    aliases: ['regime', 'regimes', 'shock', 'shock years', 'shock windows', 'taper', 'taper tantrum', 'silver squeeze', 'efp', 'covid', 'ftx', 'tariff', 'macro regime'],
    short: 'Documented macro-shock windows excluded in the regime-robustness test; separate from the macro dashboard’s regime label.',
    body: p(
      'The shock windows are documented historical events, not fitted to prices. Precious metals: the 2011 silver blow-off and margin-hike crash (Apr–Sep 2011), the 2013 taper-tantrum gold crash (Apr–Jul 2013), the 2020 pandemic COMEX–London EFP blowout (Mar–Sep 2020), the 2021 retail silver squeeze (late Jan–Mar 2021), the 2024–25 US tariff stockpiling into COMEX (Dec 2024–Apr 2025) and the October 2025 London silver liquidity squeeze (mid-Sep–Nov 2025). Bitcoin: the March 2020 liquidation, the May–Jul 2021 China mining ban, the FTX collapse (Nov–Dec 2022) and the US spot-ETF launch (Jan–Feb 2024). Copper: the 2020 pandemic collapse and rebound, the March 2022 LME nickel squeeze, and the 2025 US Section 232 copper tariff episode.',
      'On the Macro page, "regime" means something else: a label built from real yields, the dollar and risk appetite.',
    ),
    pages: ['/quant', '/macro'],
    related: ['oos', 'structural', 'macro'],
  },
  {
    id: 'calendar',
    term: 'Calendar spread',
    aliases: ['calendar', 'calendar spread', 'calendars', 'cal', 'cal01', 'time spread', 'roll spread', 'front spread', 'buy the spread', 'sell the spread', 'c0 − c1'],
    short: 'Front minus back of the same product (c0 − c1); trades the curve slope, not the price level.',
    body: p(
      'A calendar spread is one contract month against another of the same product. In this platform its value is front minus back (c0 − c1, e.g. GC.cal.0-1). **Buying (long) the calendar** = buy the front, sell the back: it gains when the front rises relative to the back (the curve flattens toward backwardation). **Selling (short)** = sell the front, buy the back: it gains when contango widens.',
      'A calendar mostly carries interest-rate and lease-rate (financing) exposure, not price exposure: in contango c0 − c1 is negative and roughly −(price × financing rate × time between expiries). The engine fades its z unless the carry veto (trending slope) or another gate blocks it. Dollar P&L = change in spread × point value.',
    ),
    pages: ['/quant', '/markets/curve'],
    related: ['carry', 'butterfly', 'spread-execution', 'month-codes'],
  },
  {
    id: 'month-codes',
    term: 'Futures month codes and contract symbols',
    aliases: ['month code', 'month codes', 'contract name', 'contract names', 'symbol', 'symbols', 'ticker', 'letters and numbers', 'gcz26', 'z26', 'expiry', 'contract month', 'active months', 'front month', 'c0', 'c1', 'c2', 'point value', 'contract size', 'multiplier', 'micro'],
    short: 'A contract symbol is root + month code + two-digit year: GCZ26 = COMEX gold, December 2026.',
    body: p(
      `A futures symbol is **root + month letter + year**. Month codes (CME convention): ${MONTH_TABLE}. So **GCZ26** = gold (GC) December (Z) 2026, **SIH27** = silver March 2027, **BTCV26** = CME bitcoin October 2026. "Z26" alone means December 2026.`,
      'Continuous legs are numbered from the front: c0 = the front active contract, c1 = the next active one, c2 the one after. Instrument ids combine them: GC.cal.0-1 = gold front-minus-next calendar, GC.fly.0-1-2 = gold c0 − 2·c1 + c2 butterfly, GC.seas.M-Q = gold June–August seasonal pair, GS.ratio = gold/silver ratio, BTC.basis = bitcoin cash-and-carry basis. These ids are this platform’s internal names, not exchange symbols. The trade ticket names the real contracts behind each leg on the as-of date.',
      `Products and active months in this platform (curves and calendars ignore serial months):\n${PRODUCT_LINES}`,
    ),
    pages: ['/quant', '/markets', '/portfolio'],
    related: ['calendar', 'butterfly', 'spread-execution'],
  },
  {
    id: 'spread-execution',
    term: 'Executing spreads and flies on CME',
    aliases: ['how to trade', 'execute', 'execution', 'how would i trade', 'how do i trade', 'leg', 'legging', 'legging in', 'exchange-listed spread', 'listed spread', 'implied', 'spread margin', 'margin offset', 'margin', 'globex', 'cme', 'comex', 'nymex', 'order', 'roll', 'cómo se opera', 'como se opera', 'operar', 'se opera'],
    short: 'Trade the exchange-listed spread or butterfly as one instrument where possible; legging separately risks slippage. Spreads get margin offsets.',
    body: p(
      'CME Globex lists calendar spreads and butterflies on COMEX/NYMEX metals and CME bitcoin as single tradable instruments, identified by their contract months (e.g. a GCZ26–GCG27 calendar), not by this platform’s internal ids such as GC.fly.0-1-2 (one price for the whole package, quoted as the spread value). Trading the listed spread fills all legs at once, so there is no legging risk; liquidity is best in the front active months and thins in the back. Exchange matching also uses *implied* prices between outrights and spreads.',
      'The alternative is **legging**: entering each outright separately. It can be cheaper when the outrights are much more liquid, but the market can move between fills and leave you with an unintended outright position. For ratio trades between products (e.g. gold vs silver) there is usually no single listed instrument, so the legs are placed separately, ideally simultaneously.',
      'Margin: exchanges and brokers recognise that spread legs offset, so a calendar or fly usually needs far less initial margin than the sum of the outright legs (intra-commodity spread credits); inter-commodity pairs get smaller credits. Exact figures change and depend on your clearing broker, so check the current CME SPAN/broker numbers before trading. Physically delivered metals must be rolled or closed before first notice; cash-settled bitcoin futures settle to the CME CF Bitcoin Reference Rate.',
      'This platform is advisory: it names the legs and quantities in the trade ticket but places no orders.',
    ),
    pages: ['/quant'],
    related: ['butterfly', 'calendar', 'ratio', 'month-codes'],
  },
  {
    id: 'basis',
    term: 'Cash-and-carry basis',
    aliases: ['basis', 'cash-and-carry', 'cash and carry', 'carry harvest', 'excess carry', 'annualized basis', 't-bill', 'tbill', 'funding', 'spot vs future'],
    short: 'Long spot, short the front future to earn the annualized basis over the T-bill; one-sided, not a directional bet.',
    body: p(
      'Basis = (future ÷ spot − 1) × 365 ÷ days to expiry, in % p.a. The engine trades the **excess carry** = basis − 13-week T-bill yield, through the same z / OU / walk-forward / verdict machinery as every spread.',
      'The trade is one-sided: when excess carry is rich (z > 0) the harvest is long spot (or a spot ETF) and short the front future, flat the asset, earning the basis as the future converges to spot at expiry. When carry is cheap the engine stands aside rather than reversing (shorting spot is impractical). The page shows $ per bp per contract, the locked-in gross carry, the funding cost at the T-bill and the excess carry to expiry, all per contract.',
    ),
    pages: ['/quant/relative-value', '/quant'],
    related: ['carry', 'month-codes'],
  },

  // ── Markets, macro, intelligence ────────────────────────────────────────
  {
    id: 'cot',
    term: 'COT positioning',
    aliases: ['cot', 'commitments of traders', 'cftc', 'managed money', 'leveraged funds', 'speculators', 'positioning', 'net long', 'open interest', 'disaggregated', 'tff'],
    short: 'CFTC weekly positions: managed money (disaggregated report) for metals, leveraged funds (TFF report) for bitcoin.',
    body: p(
      'The CFTC publishes futures positions every Friday for the prior Tuesday. For the metals the app uses the **disaggregated** report and treats **managed money** (hedge funds, CTAs) as the speculator group; for bitcoin it uses the **Traders in Financial Futures** report and its **leveraged funds** group.',
      'The app shows the speculator net as % of open interest, its 3-year percentile and z. Extremes are contrarian-leaning context (crowded longs can unwind), not timing signals; for bitcoin the reading is informational only.',
    ),
    pages: ['/macro'],
    related: ['macro'],
  },
  {
    id: 'macro',
    term: 'Macro scorecard',
    aliases: ['macro', 'scorecard', 'tailwind', 'headwind', 'real yields', 'real yield', 'dxy', 'dollar', 'tips', 'drivers', 'fred', 'vix'],
    short: 'Per-asset driver scorecard (tailwind/headwind by documented rule) and a regime label from real yields, the dollar and risk.',
    body: p(
      'Each asset class has a driver set (for precious metals: real yields, the dollar, inflation expectations, risk; for copper: growth and the dollar; for bitcoin: liquidity and risk appetite). Every driver row shows its value, 1- and 3-month change, z, and a stance — tailwind, headwind or neutral — from a documented rule printed next to it. Net score = tailwinds − headwinds. Data comes from FRED, Yahoo and the CFTC with dates on every row.',
    ),
    pages: ['/macro'],
    related: ['cot', 'regimes'],
  },
  {
    id: 'ml-gate',
    term: 'ML validation gate',
    aliases: ['ml', 'machine learning', 'model', 'auc', 'permutation', 'p-value', 'p value', 'hit rate', 'calibration', 'calibrated', 'brier', 'baseline', 'logistic', 'p(up)', 'pup', 'p converge', 'validation status', 'signal'],
    short: 'The 20-day direction model counts only if permutation p < 0.05, AUC ≥ 0.55, hit rate ≥ 0.52, it beats a logistic baseline, over ≥ 3 test years.',
    body: p(
      'A gradient-boosted classifier estimates the probability that the asset’s reference price is higher 20 trading days later. It is retrained each year on past data only and tested on the next year (walk-forward).',
      'It is **validated** only if all checks pass: permutation p-value < 0.05 (the edge beats models trained on shuffled labels), mean out-of-sample AUC ≥ 0.55 (0.5 = coin flip), hit rate ≥ 52%, AUC above a plain logistic-regression baseline, and at least 3 test years. Until then the number is shown muted and is not counted anywhere (the QT rank’s ML boost is 0).',
      '**Calibration**: readings near 60% should have come true about 60% of the time out-of-sample; the Brier score (lower is better, 0.25 = coin flip) summarises it.',
    ),
    pages: ['/intelligence', '/quant'],
    related: ['qt-rank', 'oos'],
  },
  {
    id: 'etf-premium',
    term: 'ETF premium/discount',
    aliases: ['premium', 'discount', 'nav premium', 'etf premium', 'etf', 'etfs', 'tracking', 'tracking error', 'tracking difference', 'gld', 'slv', 'phys', 'pslv', 'closed-end', 'expense ratio'],
    short: 'Last price vs the fund’s published NAV (or a modeled NAV for closed-end trusts); tracking vs the front future.',
    body: p(
      'Premium/discount compares the ETF’s last price with the latest NAV the sponsor published (struck at the prior business day’s reference price, the LBMA PM for metals), so small readings (±0.3%) intraday are mostly the underlying’s move since the fix. For closed-end trusts such as PHYS/PSLV the app shows a **Modeled** premium: today’s price vs the trust’s median metal-per-unit ratio over the past year, i.e. rich or cheap relative to its own norm, not to the published NAV.',
      'Tracking difference (1-year ETF return − front-future return) includes fees and the futures roll; tracking error is the annualized standard deviation of weekly return differences.',
    ),
    pages: ['/markets'],
    related: ['nav-unit'],
  },

  // ── Portfolio ───────────────────────────────────────────────────────────
  {
    id: 'nav-unit',
    term: 'NAV per unit',
    aliases: ['nav', 'nav per unit', 'nav/unit', 'units', 'unitization', 'subscription', 'redemption', 'net asset value'],
    short: 'Fund NAV ÷ units outstanding; subscriptions and redemptions buy or cancel units at the day’s NAV/unit, so flows don’t move it.',
    body: p(
      'NAV = cash + market value of ETFs, equities and physical holdings (physical after the haircut) + futures variation P&L (futures add their unrealized P&L, not their notional). Investors subscribe and redeem at the day’s NAV per unit, which is why NAV/unit measures performance and NAV alone does not.',
    ),
    pages: ['/portfolio', '/investor', '/'],
    related: ['twr', 'physical'],
  },
  {
    id: 'twr',
    term: 'TWR and IRR',
    aliases: ['twr', 'time-weighted', 'time weighted', 'irr', 'xirr', 'money-weighted', 'money weighted', 'return', 'mtd', 'ytd', 'since inception', 'attribution', 'contribution'],
    short: 'TWR chain-links daily NAV/unit returns (flow-neutral); IRR is money-weighted and rewards the timing of flows.',
    body: p(
      '**TWR** (time-weighted return) chain-links daily NAV/unit returns, so investor flows don’t distort it; it measures the manager. **IRR** (money-weighted, XIRR) uses subscriptions and redemptions as cash flows with opening and closing NAV, so it rewards or penalises the timing of flows; it measures the investor’s experience.',
      'Contributions are daily P&L divided by prior-day NAV, linked by NAV/unit growth so they sum exactly to TWR.',
    ),
    pages: ['/portfolio', '/investor'],
    related: ['nav-unit', 'risk-ratios'],
  },
  {
    id: 'risk-ratios',
    term: 'Sharpe, Sortino and Calmar',
    aliases: ['sharpe', 'sortino', 'calmar', 'volatility', 'vol', 'risk-adjusted', 'risk adjusted', 'risk-free rate', 'benchmark'],
    short: 'Sharpe = excess return ÷ volatility; Sortino uses downside deviation; Calmar = annualized return ÷ max drawdown.',
    body: p(
      '**Sharpe** = (annualized return − risk-free rate) ÷ annualized volatility. **Sortino** replaces volatility with downside deviation (only losing days count), so upside swings aren’t penalised. **Calmar** = annualized return ÷ |max drawdown|. All use daily NAV/unit returns over the selected period; the risk-free rate is a fund setting. Short histories make all three noisy.',
    ),
    pages: ['/portfolio', '/investor'],
    related: ['twr', 'drawdown', 'var'],
  },
  {
    id: 'var',
    term: 'VaR and CVaR',
    aliases: ['var', 'value at risk', 'value-at-risk', 'cvar', 'expected shortfall', 'tail risk', 'parametric', 'historical var'],
    short: 'One-day loss not exceeded on 95% (99%) of days; CVaR is the average loss beyond VaR.',
    body: p(
      '**VaR** is a one-day loss not exceeded on 95% (or 99%) of days. *Historical* VaR is the empirical quantile of past daily returns; *parametric* assumes a Gaussian with the measured volatility (it understates fat tails). **CVaR** (expected shortfall) is the average loss on the days beyond VaR, a better read of how bad the bad days are. Shown in % of NAV and USD.',
    ),
    pages: ['/portfolio'],
    related: ['risk-ratios', 'drawdown'],
  },
  {
    id: 'drawdown',
    term: 'Drawdown',
    aliases: ['drawdown', 'max drawdown', 'maximum drawdown', 'peak', 'trough', 'recovery', 'underwater'],
    short: 'Decline of NAV/unit from its running peak; max drawdown is the worst such decline, with peak, trough and recovery dates.',
    body: p(
      'Drawdown = NAV/unit ÷ its running peak − 1. **Max drawdown** is the deepest one in the period, reported with its peak, trough and recovery dates and duration in calendar days; **current** drawdown is today’s distance from the peak.',
    ),
    pages: ['/portfolio', '/investor'],
    related: ['risk-ratios', 'var'],
  },
  {
    id: 'physical',
    term: 'Physical vault and haircut',
    aliases: ['physical', 'vault', 'bullion', 'bars', 'coins', 'allocated', 'haircut', 'fine oz', 'fine ounces', 'purity', 'custody', 'serial'],
    short: 'Allocated bars and coins valued at spot × fine ounces × (1 − haircut); bitcoin held as a custody balance.',
    body: p(
      'The vault records each bar or coin with its gross weight, purity, fine ounces and serial. Physical holdings are valued at spot × fine quantity × (1 − **haircut**): the haircut (a fund setting, 0 by default) conservatively marks metal below spot to reflect the dealer bid, assay and transport costs of actually selling it. Bitcoin is held as a custody balance in BTC.',
    ),
    pages: ['/portfolio'],
    related: ['nav-unit'],
  },
  {
    id: 'platform',
    term: 'How this platform is organised',
    aliases: ['platform', 'app', 'dashboard', 'where', 'page', 'navigation', 'how does this work', 'data center', 'recompute', 'settings'],
    short: 'Fund (Overview, Portfolio, Investor report), Research (Markets, Quant Lab, Macro & AI, Intelligence), System (Data Center, Settings).',
    body: p(
      '**Overview**: NAV, allocation, top quant opportunities, macro and ML at a glance. **Portfolio**: holdings, ledger, performance, vault and scenarios. **Investor report**: the printable factsheet. **Markets**: prices, futures curve, ETFs, technicals, liquidity and comparison. **Quant Lab**: scanner, spreads and flies, seasonality, relative value, term structure and backtest, each instrument with gates, out-of-sample validation and a verdict. **Macro & AI**: macro scorecard, COT positioning, correlations and the AI analyst reports. **Intelligence**: the ML signal, its validation and calibration. **Data Center**: data downloads, Databento history and scheduled jobs. **Settings**: API keys, AI models and budgets, admin PIN.',
      'The asset switch in the top bar sets the asset in focus everywhere. Data is local (SQLite); every panel shows its source and data date. Nothing is executed: the platform is advisory.',
    ),
    pages: ['/'],
    related: ['verdict', 'qt-rank'],
  },
]

const BY_ID = new Map(GLOSSARY.map((e) => [e.id, e]))

export function glossaryEntry(id: string): GlossaryEntry {
  const e = BY_ID.get(id)
  if (!e) throw new Error(`Unknown glossary entry: ${id}`)
  return e
}

/** Replace {name} placeholders. Unknown placeholders stay as written. PURE. */
export function fillGlossary(text: string, vars: Record<string, string> = {}): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
}

/** Generic wording for templated entries when no page-specific values exist. */
export const GENERIC_VARS: Record<string, string> = { n: 'numerator', d: 'denominator', numRoot: 'numerator', denRoot: 'denominator' }
