import { Explainer } from '../../../ui'

// "How to read this" blocks for the Quant Lab's jargon. Plain language first,
// then the exact rule the engine applies.

export function ZScoreExplainer() {
  return (
    <Explainer title="What is the z-score?">
      <p>
        The z-score says how far today&apos;s value sits from its own recent average, in standard deviations: (value − 60-day mean) ÷ 60-day σ. A z of +2 means
        the spread is unusually high; −2 unusually low.
      </p>
      <p>
        The engine <strong>fades</strong> the stretch: z &gt; 0 ⇒ short the structure, z &lt; 0 ⇒ long it. The score (0–100) rises with |z| and is damped when
        seasonality disagrees or volatility is blowing up. <em>Effective z</em> uses a lookback sized to the spread&apos;s own half-life instead of 60 days.
      </p>
    </Explainer>
  )
}

export function OuExplainer() {
  return (
    <Explainer title="What is the OU half-life?">
      <p>
        An Ornstein–Uhlenbeck fit treats the spread as a rubber band: x(t+1) = a + b·x(t). The <strong>half-life</strong> ln 2 ÷ (−ln b) is how many trading
        days it takes, on average, for half of a deviation to disappear.
      </p>
      <p>
        Tradable only between 5 and 60 days: faster is microstructure noise, slower won&apos;t converge within the holding horizon, and b ≥ 1 means there is no
        pull back at all (a random walk). Failing this gate damps the rank and blocks a conservative BUY.
      </p>
    </Explainer>
  )
}

export function ContangoExplainer() {
  return (
    <Explainer title="Contango, backwardation and carry">
      <p>
        <strong>Contango</strong>: deferred contracts trade above the front, the normal state for gold and silver because holding metal costs interest and storage. <strong>Backwardation</strong>:
        the front trades above deferreds, a sign of immediate scarcity (tight lease market, delivery squeeze).
      </p>
      <p>
        Annualized carry = (deferred ÷ front − 1) ÷ years between expiries; for gold it tracks short-term USD rates minus the gold lease rate. The engine vetoes fading a calendar when
        the curve slope itself is trending (momentum z ≥ 2).
      </p>
    </Explainer>
  )
}

export function ButterflyExplainer() {
  return (
    <Explainer title="What is a butterfly?">
      <p>
        A butterfly is long the front and back months and short twice the middle: c0 − 2·c1 + c2. On a smooth carry curve the middle month sits on the straight line between the wings, so
        the fly is near zero; its value is −2 × the middle month&apos;s <strong>bow</strong> off that line.
      </p>
      <p>
        It isolates curve shape from price level and from the overall slope, so it is usually the cleanest mean-reversion structure — unless the curve is being structurally repriced
        (the regime gate below).
      </p>
    </Explainer>
  )
}

export function StructuralExplainer() {
  return (
    <Explainer title="What is the structural-move gate?">
      <p>
        Spreads bend for real reasons too: a squeeze, a rate shock, a flip into backwardation. The gate measures how many σ the front outright and the curve slope are from their own
        60-day noise bands. Beyond ±2.5σ the move is treated as structural and fading it is blocked (&ldquo;regime-off&rdquo;).
      </p>
    </Explainer>
  )
}

export function SeasonalExplainer() {
  return (
    <Explainer title="How to read the seasonality">
      <p>
        The shaded envelope shows, for each day of the year, where the value sat across past years (10–90% and 25–75% ranges); the solid line is the average and the coloured line is
        this season. Outrights and the ratio are rebased to % change from each season&apos;s start; spreads are shown in $/oz.
      </p>
      <p>
        Roll-clean pair spreads (e.g. gold Jun–Aug) are rebuilt from the same two contract months every year, so there is no roll splice. Their contract window starts nine months
        before the front month, so the axis starts where each season starts. Windows are searched on <strong>prior seasons only</strong>, and a window only earns trust when the
        walk-forward test (pick the window on past years, trade it blind on the next) passes: ≥ 3 out-of-sample years, ≥ 60% wins, positive average, |t| ≥ 1.5.
      </p>
    </Explainer>
  )
}

export function RatioExplainer() {
  return (
    <Explainer title="The gold/silver ratio">
      <p>
        Ounces of silver one ounce of gold buys (GC front ÷ SI front). A high ratio means silver is cheap relative to gold. Trading it means a dollar-neutral pair: long $X of gold and
        short $X of silver (or the reverse), sized with the hedge ratio shown.
      </p>
      <p>
        Bands are the 252-day mean ± 1σ / ± 2σ. The OU half-life of the ratio is usually long — relative value between metals reverts over months, not days — which the gate flags.
      </p>
    </Explainer>
  )
}

export function BacktestExplainer() {
  return (
    <Explainer title="How the backtest works">
      <p>
        A point-in-time replay: roughly once a month for the last ten years, the engine is rebuilt with only the data available on that date — including an out-of-sample status
        computed from completed prior years — and asked for its verdict. The outcome 20 sessions later is booked, risk-equalized so a 1σ favourable move ≈ $1,000, less $30 costs.
      </p>
      <p>
        <strong>Model</strong> books only its BUY/SELL verdicts; the <strong>baseline</strong> fades every stretch. The gap is the verdict&apos;s selection value. It is an illustration, not a
        promise: overlapping holding periods and one path of history.
      </p>
    </Explainer>
  )
}

export function VerdictExplainer() {
  return (
    <Explainer title="Conservative vs aggressive">
      <p>
        <strong>Conservative</strong> acts only on an edge that passed walk-forward out-of-sample testing, scores ≥ MODERATE, has no AVOID override, is not regime-fragile, has an OU
        half-life in bounds, no carry veto and no structural move in progress. <strong>Aggressive</strong> acts on the live signal (score ≥ WATCH, no AVOID override) and shows OOS, ML and
        the gates as context.
      </p>
      <p>BUY = go long the structure, SELL = go short it; the legs are named with the real contracts. Advisory only — nothing is executed.</p>
    </Explainer>
  )
}

export function KellyExplainer() {
  return (
    <Explainer title="Half-Kelly sizing (illustrative)">
      <p>
        Kelly f* = p − (1 − p) ÷ b, with p the out-of-sample win rate and b the average win ÷ average loss. Full Kelly is famously aggressive and the inputs are noisy with a handful of
        trades, so the suggestion is half of it, capped at 25% of the risk capital you allocate to this sleeve. Treat it as an upper bound, not a recommendation.
      </p>
    </Explainer>
  )
}
