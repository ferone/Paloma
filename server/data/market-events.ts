// Curated database of major gold-market-moving events
// Used to explain volume spikes in the liquidity history chart
// Dates are the trading day when markets reacted (not necessarily the event date itself)

export interface MarketEvent {
  date: string // YYYY-MM-DD (trading day)
  title: string
  description: string
}

export const MARKET_EVENTS: MarketEvent[] = [
  // ── 2024 ──────────────────────────────────────────────

  // FOMC decisions
  {
    date: '2024-01-31',
    title: 'FOMC Holds Rates, Pushes Back on March Cut',
    description:
      'The Fed held rates at 5.25-5.50% and Chair Powell explicitly pushed back on a March rate cut, triggering repositioning across gold markets.',
  },
  {
    date: '2024-03-20',
    title: 'FOMC Holds, Signals Three 2024 Cuts',
    description:
      'The Federal Reserve held rates but maintained its projection of three rate cuts in 2024, sending gold surging past $2,200 for the first time.',
  },
  {
    date: '2024-05-01',
    title: 'FOMC Holds, Signals QT Taper',
    description:
      'The Fed held rates and announced it would slow the pace of balance sheet reduction starting in June, easing financial conditions and supporting gold.',
  },
  {
    date: '2024-06-12',
    title: 'CPI + FOMC Same-Day Double Event',
    description:
      'May CPI came in cooler than expected the same day the FOMC held rates with hawkish guidance reducing projected cuts to one, creating whipsaw volume in gold.',
  },
  {
    date: '2024-07-31',
    title: 'FOMC Holds, Hints at September Cut',
    description:
      'The Fed held rates but signaled a September cut was on the table, with Chair Powell noting inflation had moved closer to target.',
  },
  {
    date: '2024-09-18',
    title: 'Fed Cuts 50bp — First Cut Since 2020',
    description:
      'The Federal Reserve cut rates by 50 basis points to 4.75-5.00%, the first cut since March 2020 and larger than the 25bp most expected, supercharging gold.',
  },
  {
    date: '2024-11-07',
    title: 'Fed Cuts 25bp Post-Election',
    description:
      'The Fed cut rates by 25bp the day after the U.S. election, as markets digested the dual impact of monetary easing and a new administration.',
  },
  {
    date: '2024-12-18',
    title: 'Fed Cuts 25bp But Signals Fewer 2025 Cuts',
    description:
      'The Fed cut rates 25bp but the dot plot projected only two cuts in 2025 (down from four), shocking markets and driving heavy gold repositioning.',
  },

  // CPI releases 2024
  {
    date: '2024-01-11',
    title: 'December CPI Hotter Than Expected',
    description:
      'December CPI came in at 3.4% vs. 3.2% expected, dampening rate-cut hopes and triggering heavy volume in gold futures.',
  },
  {
    date: '2024-02-13',
    title: 'January CPI Hotter Than Expected',
    description:
      'U.S. January CPI came in at 3.1% vs. 2.9% expected, dashing hopes for early Fed rate cuts and sparking heavy gold repositioning.',
  },
  {
    date: '2024-03-12',
    title: 'February CPI Slightly Hot',
    description:
      'February CPI at 3.2% exceeded the 3.1% forecast, reinforcing the Fed\'s cautious stance and driving gold volume as rate-cut timelines shifted.',
  },
  {
    date: '2024-04-10',
    title: 'March CPI Hotter Than Expected',
    description:
      'March CPI surprised to the upside at 3.5% vs. 3.4% expected, pushing back rate-cut expectations further and driving sharp gold repricing.',
  },
  {
    date: '2024-05-15',
    title: 'April CPI Shows Modest Cooling',
    description:
      'April CPI came in at 3.4%, in line with expectations and down from 3.5%, reviving hopes for a September rate cut and boosting gold.',
  },
  {
    date: '2024-07-11',
    title: 'June CPI Turns Negative Monthly',
    description:
      'June CPI showed the first monthly decline since 2020, dramatically boosting rate-cut expectations and driving heavy gold buying.',
  },
  {
    date: '2024-08-14',
    title: 'July CPI Confirms Disinflation Trend',
    description:
      'July CPI fell to 2.9%, the lowest since March 2021, cementing expectations for a September rate cut and supporting gold demand.',
  },
  {
    date: '2024-09-11',
    title: 'August CPI Slightly Above Expectations',
    description:
      'August core CPI ticked up to 0.3% monthly vs. 0.2% expected, tempering expectations for a jumbo Fed cut and creating gold volatility.',
  },
  {
    date: '2024-10-10',
    title: 'September CPI Slightly Hot',
    description:
      'September CPI at 2.4% came slightly above the 2.3% forecast, though the overall trend remained downward, driving gold volume.',
  },
  {
    date: '2024-11-13',
    title: 'October CPI In Line at 2.6%',
    description:
      'October CPI met expectations at 2.6%, maintaining the steady disinflation narrative and keeping December cut expectations intact.',
  },
  {
    date: '2024-12-11',
    title: 'November CPI at 2.7%',
    description:
      'November CPI ticked up to 2.7% as expected, keeping the Fed on track for a December cut but raising questions about the 2025 path.',
  },

  // Jobs reports 2024
  {
    date: '2024-02-02',
    title: 'January Jobs Blow Out at 353K',
    description:
      'January non-farm payrolls massively beat expectations at 353K vs. 180K forecast, pushing back rate-cut expectations and roiling gold markets.',
  },
  {
    date: '2024-03-08',
    title: 'February Jobs Report With Downward Revisions',
    description:
      'February payrolls came in at 275K but prior months were sharply revised down, fueling rate-cut bets and driving gold above $2,100.',
  },
  {
    date: '2024-06-07',
    title: 'May Jobs Surprisingly Strong',
    description:
      'May non-farm payrolls surged to 272K vs. 180K expected, temporarily denting gold as rate-cut expectations shifted further out.',
  },
  {
    date: '2024-08-02',
    title: 'Weak Jobs Report Sparks Recession Fears',
    description:
      'July non-farm payrolls came in at just 114K vs. 175K expected, triggering the Sahm Rule recession indicator and a flight to gold.',
  },
  {
    date: '2024-10-04',
    title: 'September Jobs Blowout — 254K',
    description:
      'September payrolls surged to 254K vs. 140K expected with upward revisions, dramatically reducing recession fears and whipsawing gold.',
  },

  // Geopolitical events 2024
  {
    date: '2024-04-15',
    title: 'Iran-Israel Military Escalation',
    description:
      'Iran launched over 300 drones and missiles at Israel over the weekend. Markets opened Monday with a massive safe-haven rush into gold.',
  },
  {
    date: '2024-08-05',
    title: 'Global Market Crash — Yen Carry Trade Unwind',
    description:
      'The Japanese yen carry trade violently unwound, VIX spiked to 65, and global equities crashed. Gold saw massive safe-haven inflows.',
  },
  {
    date: '2024-11-06',
    title: 'U.S. Presidential Election — Trump Wins',
    description:
      'Donald Trump won the presidential election decisively. Gold saw extreme volume as traders repriced tariff, fiscal, and dollar expectations.',
  },

  // Gold milestones 2024
  {
    date: '2024-05-20',
    title: 'Gold Hits Record $2,450',
    description:
      'Gold broke through $2,450 for the first time, driven by persistent central bank buying and geopolitical uncertainty.',
  },
  {
    date: '2024-10-30',
    title: 'Gold Nears $2,800 Pre-Election',
    description:
      'Gold surged to nearly $2,800 as election uncertainty peaked, with traders hedging all outcomes ahead of the U.S. presidential vote.',
  },

  // ── 2025 ──────────────────────────────────────────────

  // FOMC decisions 2025
  {
    date: '2025-01-29',
    title: 'FOMC Holds Rates at 4.25-4.50%',
    description:
      'The Fed held rates steady at the first meeting of 2025, citing continued progress on inflation but maintaining a cautious approach amid tariff uncertainty.',
  },
  {
    date: '2025-03-19',
    title: 'FOMC Holds, Cites Tariff Uncertainty',
    description:
      'The Fed held rates and Chair Powell said the committee is focused on "separating signal from noise" as tariff policy clouds the economic outlook.',
  },
  {
    date: '2025-05-07',
    title: 'FOMC Holds Amid Tariff-Driven Inflation Fears',
    description:
      'The Fed held rates steady, citing that "uncertainty about the economic outlook has increased further" with risks of both higher unemployment and inflation.',
  },
  {
    date: '2025-05-28',
    title: 'FOMC Minutes Warn of Tariff-Inflation Tradeoffs',
    description:
      'The release of May FOMC minutes revealed the Fed warning it "could face difficult tradeoffs if tariffs reaggravate inflation," rattling gold markets.',
  },
  {
    date: '2025-06-18',
    title: 'FOMC Holds, Signals Patience on Cuts',
    description:
      'The Fed kept rates unchanged and signaled it would remain patient before cutting, as tariff impacts on prices remained uncertain.',
  },
  {
    date: '2025-07-30',
    title: 'Fed Cuts 25bp as Economy Slows',
    description:
      'The Fed cut rates by 25bp as economic data showed the impact of trade restrictions, marking the first easing move of 2025 and boosting gold.',
  },
  {
    date: '2025-09-17',
    title: 'Fed Cuts 25bp Again',
    description:
      'The Fed delivered another 25bp cut as inflation continued moderating, pushing rates to 3.75-4.00% and supporting gold\'s ongoing rally.',
  },
  {
    date: '2025-10-29',
    title: 'FOMC Holds, Assesses Cumulative Cuts',
    description:
      'The Fed paused rate cuts to assess the impact of prior easing, with markets debating whether more cuts would come in December.',
  },
  {
    date: '2025-12-10',
    title: 'Fed Cuts 25bp, Projects More Easing in 2026',
    description:
      'The Fed cut rates to 3.50-3.75% and the dot plot projected continued easing into 2026, fueling gold\'s year-end surge past $4,500.',
  },

  // Tariff / trade events 2025
  {
    date: '2025-01-20',
    title: 'Trump Inauguration — Executive Orders on Trade',
    description:
      'President Trump was inaugurated and signed a wave of executive orders on trade and tariffs, triggering uncertainty-driven gold volume.',
  },
  {
    date: '2025-02-04',
    title: 'New Tariffs Take Effect on China',
    description:
      'A 10% tariff on Chinese imports took effect while Mexico and Canada tariffs were delayed after last-minute negotiations, roiling commodity markets.',
  },
  {
    date: '2025-03-04',
    title: 'Tariffs on China Double to 20%',
    description:
      'The U.S. doubled tariffs on China to 20% and imposed 25% on Canada and Mexico, escalating trade war fears and driving gold demand.',
  },
  {
    date: '2025-03-27',
    title: 'Auto Tariffs Announced — 25% on All Imports',
    description:
      'President Trump announced 25% tariffs on all imported automobiles and auto parts, broadening trade tensions and pushing gold higher as consumer confidence hit a 12-year low.',
  },
  {
    date: '2025-04-02',
    title: '"Liberation Day" — Sweeping Tariffs Announced',
    description:
      'President Trump announced sweeping reciprocal tariffs on nearly all trading partners, triggering the largest single-day gold volume spike in months.',
  },
  {
    date: '2025-04-09',
    title: '90-Day Tariff Pause — Massive Relief Rally',
    description:
      'Trump paused most reciprocal tariffs for 90 days (except China, raised to 145%). Markets whipsawed with record volume as traders unwound hedges.',
  },

  // Gold milestones 2025
  {
    date: '2025-03-14',
    title: 'Gold Breaks $3,000 for First Time',
    description:
      'Gold crossed the historic $3,000/oz milestone for the first time, fueled by central bank accumulation, trade war fears, and dollar weakness.',
  },
  {
    date: '2025-04-22',
    title: 'Gold Hits $3,500 as Dollar Slides',
    description:
      'Gold surged past $3,500/oz as the U.S. dollar weakened sharply on concerns over Fed independence and escalating trade tensions with China.',
  },
  {
    date: '2025-10-07',
    title: 'Gold Breaks $4,000 — U.S. Shutdown Fears',
    description:
      'Gold smashed through $4,000/oz for the first time as a looming U.S. government shutdown added fuel to a rally driven by rate cuts, central bank buying, and dollar weakness.',
  },
  {
    date: '2025-12-24',
    title: 'Gold Tops $4,500 on Geopolitical Tensions',
    description:
      'Gold surged past $4,500/oz for the first time amid escalating Venezuela tensions and broad dollar weakness, capping a year with 70%+ gains.',
  },

  // Other major 2025 events
  {
    date: '2025-11-25',
    title: 'Fed Governor Waller Backs December Rate Cut',
    description:
      'Fed Governor Christopher Waller publicly backed a December rate cut, sending gold above $4,100 as the dollar weakened on rising easing expectations.',
  },

  // ── 2026 ──────────────────────────────────────────────

  {
    date: '2026-01-28',
    title: 'FOMC Holds + Gold Hits $5,589 All-Time High',
    description:
      'The Fed held rates at 3.50-3.75% as gold surged over $300 in a single day to a record $5,589/oz, driven by escalating U.S.-Iran tensions and record ETF inflows of $19B for the month.',
  },
  {
    date: '2026-01-29',
    title: 'Gold Crashes $380 in 28 Minutes',
    description:
      'Gold plunged $380 (nearly 7%) in just 28 minutes as profit-taking and algorithmic selling hit after the record high, with the metal falling from near $5,600.',
  },
  {
    date: '2026-01-30',
    title: 'Kevin Warsh Nominated as Fed Chair — Metals Crash',
    description:
      'Trump announced Kevin Warsh as next Federal Reserve Chair. Gold crashed over 10% and silver plunged 30% in the biggest precious metals selloff since the 1980s as markets repriced rate expectations.',
  },
]
