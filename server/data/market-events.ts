// Curated database of major gold-market-moving events
// Used to explain volume spikes in the liquidity history chart
// Dates are the trading day when markets reacted (not necessarily the event date itself)

export interface MarketEvent {
  date: string // YYYY-MM-DD (trading day)
  title: string
  description: string
}

export const MARKET_EVENTS: MarketEvent[] = [
  // ── 2024 ──
  {
    date: '2024-01-11',
    title: 'SEC Approves Spot Bitcoin ETFs',
    description:
      'The SEC approved 11 spot Bitcoin ETFs, triggering massive cross-asset rebalancing as institutional capital rotated between gold and crypto.',
  },
  {
    date: '2024-02-13',
    title: 'January CPI Hotter Than Expected',
    description:
      'U.S. January CPI came in at 3.1% vs. 2.9% expected, dashing hopes for early Fed rate cuts and sparking heavy gold futures repositioning.',
  },
  {
    date: '2024-03-08',
    title: 'Gold Surges Past $2,100 on Jobs Data',
    description:
      'February non-farm payrolls showed mixed signals with downward revisions, fueling rate-cut bets and driving gold above $2,100 on record volume.',
  },
  {
    date: '2024-03-20',
    title: 'FOMC Holds, Signals Three 2024 Cuts',
    description:
      'The Federal Reserve held rates but maintained its projection of three rate cuts in 2024, sending gold surging past $2,200 for the first time.',
  },
  {
    date: '2024-04-15',
    title: 'Iran-Israel Military Escalation',
    description:
      'Iran launched over 300 drones and missiles at Israel over the weekend. Markets opened Monday with a massive safe-haven rush into gold.',
  },
  {
    date: '2024-05-20',
    title: 'Gold Hits Record $2,450',
    description:
      'Gold broke through $2,450 for the first time, driven by persistent central bank buying and geopolitical uncertainty across multiple regions.',
  },
  {
    date: '2024-06-12',
    title: 'CPI + FOMC Same-Day Double Event',
    description:
      'May CPI came in cooler than expected the same day the FOMC held rates with hawkish guidance, creating whipsaw volume in gold markets.',
  },
  {
    date: '2024-07-11',
    title: 'June CPI Turns Negative Monthly',
    description:
      'June CPI showed the first monthly decline since 2020, dramatically boosting rate-cut expectations and driving heavy gold buying.',
  },
  {
    date: '2024-08-02',
    title: 'Weak Jobs Report Sparks Recession Fears',
    description:
      'July non-farm payrolls came in at just 114K vs. 175K expected, triggering the Sahm Rule recession indicator and a flight to gold.',
  },
  {
    date: '2024-08-05',
    title: 'Global Market Crash — Yen Carry Trade Unwind',
    description:
      'The Japanese yen carry trade violently unwound, VIX spiked to 65, and global equities crashed. Gold saw massive safe-haven inflows.',
  },
  {
    date: '2024-09-18',
    title: 'Fed Cuts 50bp — First Cut Since 2020',
    description:
      'The Federal Reserve cut rates by 50 basis points, the first cut since March 2020 and larger than the 25bp most expected, supercharging gold.',
  },
  {
    date: '2024-10-30',
    title: 'Gold Nears $2,800 Pre-Election',
    description:
      'Gold surged to nearly $2,800 as election uncertainty peaked, with polls showing a tight race and traders hedging all outcomes.',
  },
  {
    date: '2024-11-06',
    title: 'U.S. Presidential Election — Trump Wins',
    description:
      'Donald Trump won the presidential election decisively. Gold markets saw extreme volume as traders repriced tariff, fiscal, and dollar expectations.',
  },
  {
    date: '2024-12-18',
    title: 'Fed Cuts 25bp But Signals Fewer 2025 Cuts',
    description:
      'The Fed cut rates 25bp but the new dot plot projected only two cuts in 2025 (down from four), shocking markets and driving heavy gold repositioning.',
  },
  // ── 2025 ──
  {
    date: '2025-01-20',
    title: 'Trump Inauguration — Executive Orders Signed',
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
      'The U.S. doubled tariffs on China to 20% and imposed 25% tariffs on Canada and Mexico, escalating trade war fears and driving gold demand.',
  },
  {
    date: '2025-03-14',
    title: 'Gold Breaks $3,000 for First Time',
    description:
      'Gold crossed the historic $3,000/oz milestone for the first time, fueled by central bank accumulation, trade war fears, and dollar weakness.',
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
  {
    date: '2025-04-22',
    title: 'Gold Hits $3,500 as Dollar Slides',
    description:
      'Gold surged past $3,500/oz as the U.S. dollar weakened sharply on concerns over Fed independence and escalating trade tensions with China.',
  },
  {
    date: '2025-05-07',
    title: 'FOMC Holds Amid Tariff Uncertainty',
    description:
      'The Fed held rates steady, citing tariff-driven inflation uncertainty, while signaling a data-dependent approach that left gold markets volatile.',
  },
]
