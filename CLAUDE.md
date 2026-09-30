# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Gold Investment Dashboard** (repo folder: Paloma) is a fund-grade platform for a gold- and silver-focused fund. It is a React 19 + Vite 7 SPA (`src/`), an Express 5 API (`server/`) with a local SQLite database, and types shared by both (`shared/`).
- **Gold and silver are symmetric.** Every metal-specific module is parameterized by `Metal` from `shared/universe.ts`.
- **Quant engine.** Much of the quantitative engine is ported from the sibling repo `C:\Development Projects\CommodityFutures` (pure-TS modules in `lib/engine`, `lib/seasonality`, `lib/validation`, `lib/opportunities`, `lib/simulation`, `lib/data`, `lib/ai`; the Python ML is in `scripts/ml`).
- **Design direction:** `.impeccable.md` (Design Context). Read it before any UI work.

## Commands

```bash
npm run dev          # Vite (5173) + API (3001, tsx watch), concurrently
npm run build        # tsc -b (client + vite config + server) && vite build
npm run typecheck    # tsc -b only
npm run lint         # eslint
npm test             # vitest run (all *.test.ts[x] in src/, server/, shared/)
npx vitest run server/db/repo.test.ts     # single test file
npx vitest run -t "FIFO"                  # tests matching a name
npm run db:migrate   # apply pending SQLite migrations (the server also does this on boot)
```

- **Tests:** component tests opt into jsdom with a `// @vitest-environment jsdom` docblock; everything else runs under node. Server repository tests call `useTestDb()` (`server/db/client.ts`), which swaps the process-wide connection for an in-memory DB with all migrations applied.
- **Environment:** copy `.env.example` to `.env`. Integrations are optional and every feature must degrade to an explicit "not configured" state. The integrations are:
  - Databento: `DATABENTO_API_KEY`, `DATABENTO_BUDGET`
  - OpenRouter: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`
  - FRED: `FRED_API_KEY`
  - CFTC (optional): `CFTC_APP_TOKEN`

  Keys are read only through `server/lib/env.ts` and reach the client only as booleans (`GET /api/status`).
- **Local data:** `data/` (SQLite DB, downloads, ML models) is gitignored.
- **Node version:** 20 works, but `yahoo-finance2` warns that it wants Node 22 or newer.

### Data operations
```bash
npm run data:estimate -- roots=GC,SI start=2010-06-06      # FREE Databento cost estimate
npm run data:backfill -- roots=GC,SI schemas=ohlcv-1d start=2010-06-06 windowMonths=12 maxCost=3 confirm=yes   # PAID
npm run data:yahoo          # Yahoo daily history (fronts, ETFs, DXY/10Y/VIX/SPY, listed COMEX months)
npm run macro:refresh       # FRED (keyless CSV unless FRED_API_KEY) + CFTC COT
npm run quant:recompute     # quant engine over contract_bars (~35 s)
npm run ml:train            # walk-forward + permutation gate (~3 min/metal); ml:infer for daily scoring
DB_PATH=data/demo.db npm run portfolio:seed-demo   # demo ledger in a SEPARATE db; never seed the real one
```
- **Databento:**
  - Arguments are `key=value`, because npm swallows `--flags` on Windows.
  - Every pull is estimated for free first and capped by `DATABENTO_BUDGET` (default $1) unless `maxCost` is given.
  - Backfilling is idempotent (upserts), but re-pulling history is paid again, so check `databento_pulls` before re-running.
  - Use `windowMonths=12` for ohlcv-1d history. The `statistics` schema (open interest) is slow server-side (~90 s per month), so pull it only incrementally.
- **Scheduler** (Data Center → Jobs) is opt-in. It runs the registered jobs by name after the CME close.
- **Agents running shell commands:** never embed markdown or backticks in inline `node -e` / heredoc scripts. Bash executes backtick spans as commands; this once re-ran a paid backfill. Edit docs with file-editing tools.

### Data operations
\
> gold-investment-dashboard@0.0.0 data:estimate
> tsx server/marketdata/cli.ts estimate roots=GC,SI start=2010-06-06

┌─────────┬──────┬──────────────┬────────────────┐
│ (index) │ root │ schema       │ cost           │
├─────────┼──────┼──────────────┼────────────────┤
│ 0       │ 'GC' │ 'ohlcv-1d'   │ 1.545004174113 │
│ 1       │ 'GC' │ 'statistics' │ 0.991623848677 │
│ 2       │ 'SI' │ 'ohlcv-1d'   │ 1.127169802785 │
│ 3       │ 'SI' │ 'statistics' │ 0.835422277451 │
└─────────┴──────┴──────────────┴────────────────┘
Total $4.4992 for 2010-06-06 → 2026-09-30 (budget $1; OVER budget). FREE — nothing downloaded.

> gold-investment-dashboard@0.0.0 data:backfill
> tsx server/marketdata/cli.ts backfill roots=GC,SI schemas=ohlcv-1d start=2010-06-06 windowMonths=12 maxCost=3 confirm=yes

Estimate $2.6722 for GC,SI 2010-06-06→2026-09-30 (limit $3.00)
[3%] GC ohlcv-1d 2010-06-06→2011-06-04: 3876 rows
[6%] GC ohlcv-1d 2011-06-04→2012-06-02: 3658 rows
[9%] GC ohlcv-1d 2012-06-02→2013-06-01: 3525 rows
[11%] GC ohlcv-1d 2013-06-01→2014-06-07: 3570 rows
[14%] GC ohlcv-1d 2014-06-07→2015-06-06: 3026 rows
[17%] GC ohlcv-1d 2015-06-06→2016-06-04: 2787 rows
[20%] GC ohlcv-1d 2016-06-04→2017-06-03: 2717 rows
[23%] GC ohlcv-1d 2017-06-03→2018-06-02: 2643 rows
[26%] GC ohlcv-1d 2018-06-02→2019-06-01: 2543 rows
[29%] GC ohlcv-1d 2019-06-01→2020-06-06: 2720 rows
[31%] GC ohlcv-1d 2020-06-06→2021-06-05: 2515 rows
[34%] GC ohlcv-1d 2021-06-05→2022-06-04: 2397 rows
[37%] GC ohlcv-1d 2022-06-04→2023-06-03: 2353 rows
[40%] GC ohlcv-1d 2023-06-03→2024-06-01: 2435 rows
[43%] GC ohlcv-1d 2024-06-01→2025-06-07: 2640 rows
[46%] GC ohlcv-1d 2025-06-07→2026-06-06: 3658 rows
[49%] GC ohlcv-1d 2026-06-06→2026-09-30: 1039 rows
[51%] SI ohlcv-1d 2010-06-06→2011-06-04: 2850 rows
[54%] SI ohlcv-1d 2011-06-04→2012-06-02: 2395 rows
[57%] SI ohlcv-1d 2012-06-02→2013-06-01: 2406 rows
[60%] SI ohlcv-1d 2013-06-01→2014-06-07: 2263 rows
[63%] SI ohlcv-1d 2014-06-07→2015-06-06: 2173 rows
[66%] SI ohlcv-1d 2015-06-06→2016-06-04: 2145 rows
[69%] SI ohlcv-1d 2016-06-04→2017-06-03: 2076 rows

> gold-investment-dashboard@0.0.0 data:yahoo
> tsx server/marketdata/cli.ts yahoo

[2%] Yahoo GC=F
[3%] Yahoo MGC=F
[5%] Yahoo GLD
[6%] Yahoo IAU
[8%] Yahoo GLDM
[9%] Yahoo SGOL
[11%] Yahoo PHYS
[12%] Yahoo GDX
[14%] Yahoo SI=F
[15%] Yahoo SIL=F
[17%] Yahoo SLV
[18%] Yahoo SIVR
[20%] Yahoo PSLV
[21%] Yahoo SILJ
[23%] Yahoo DX-Y.NYB
[24%] Yahoo ^TNX
[26%] Yahoo ^VIX
[27%] Yahoo SPY
[29%] Yahoo TIP
[30%] Yahoo ^IRX
[32%] Yahoo GCV26.CMX
[33%] Yahoo GCZ26.CMX
[35%] Yahoo GCG27.CMX
[36%] Yahoo GCJ27.CMX
[38%] Yahoo GCM27.CMX
[39%] Yahoo GCQ27.CMX
[41%] Yahoo GCV27.CMX
[42%] Yahoo GCZ27.CMX
[44%] Yahoo GCG28.CMX
[45%] Yahoo GCJ28.CMX
[47%] Yahoo GCM28.CMX
[48%] Yahoo GCQ28.CMX
[50%] Yahoo MGCV26.CMX
[52%] Yahoo MGCZ26.CMX
[53%] Yahoo MGCG27.CMX
[55%] Yahoo MGCJ27.CMX
[56%] Yahoo MGCM27.CMX
[58%] Yahoo MGCQ27.CMX
[59%] Yahoo MGCV27.CMX
[61%] Yahoo MGCZ27.CMX
[62%] Yahoo MGCG28.CMX
[64%] Yahoo MGCJ28.CMX
[65%] Yahoo MGCM28.CMX
[67%] Yahoo MGCQ28.CMX
[68%] Yahoo SIU26.CMX
[70%] Yahoo SIZ26.CMX
[71%] Yahoo SIH27.CMX
[73%] Yahoo SIK27.CMX
[74%] Yahoo SIN27.CMX
[76%] Yahoo SIU27.CMX
[77%] Yahoo SIZ27.CMX
[79%] Yahoo SIH28.CMX
[80%] Yahoo SIK28.CMX
[82%] Yahoo SIN28.CMX
[83%] Yahoo SIU28.CMX
[85%] Yahoo SILU26.CMX
[86%] Yahoo SILZ26.CMX
[88%] Yahoo SILH27.CMX
[89%] Yahoo SILK27.CMX
[91%] Yahoo SILN27.CMX
[92%] Yahoo SILU27.CMX
[94%] Yahoo SILZ27.CMX
[95%] Yahoo SILH28.CMX
[97%] Yahoo SILK28.CMX
[98%] Yahoo SILN28.CMX
[100%] Yahoo SILU28.CMX
Yahoo: 441 daily rows across 20/20 symbols; 5424 contract rows (Databento rows untouched)

> gold-investment-dashboard@0.0.0 macro:refresh
> tsx server/macro/cli.ts

FRED 11/11 series via csv · 62831 points upserted
COT: GOLD 1059 reports through 2026-09-22 · SILVER 1059 reports through 2026-09-22
Published macro:dashboard — Real yields rising · Dollar stable · Risk mixed

> gold-investment-dashboard@0.0.0 quant:recompute
> tsx server/quant/cli.ts

[quant] Analyzed 68 instruments through 2026-09-30; 1 conservative trade signal(s). (29.7 s, run #3)

> gold-investment-dashboard@0.0.0 ml:train
> tsx server/ml/cli.ts train

gold: 6546 feature rows through 2026-09-30
Gold run #3: FAILED (p 0.505 ≥ 0.05; hit 51.8% < 52%) · P(up) 0.578
silver: 6547 feature rows through 2026-09-30
Silver run #4: FAILED (p 0.267 ≥ 0.05; hit 48.0% < 52%; AUC 0.596 ≤ baseline 0.602) · P(up) 0.396

> gold-investment-dashboard@0.0.0 portfolio:seed-demo
> tsx server/portfolio/seed-demo.ts- Databento: arguments are  (npm swallows  on Windows). Every pull is estimated for free first and capped by  (default $1) unless  is given. Use  for ohlcv-1d history. The  schema (open interest) is slow server-side (~90 s per month), so pull it only incrementally.
- Scheduler (Data Center → Jobs) is opt-in. It runs the registered jobs by name after the CME close.

## Architecture

### Layout
```
shared/          types + universe used by BOTH sides (client imports via @shared/*, server via relative ../../shared/x.js)
server/
  index.ts       boots express, opens DB (runs migrations), mountRoutes()
  routes/index.ts   the ONLY place routers are mounted (legacy Yahoo proxies + one router per domain)
  lib/env.ts     typed config; integrationStatus()
  db/            client.ts (better-sqlite3, WAL), migrate.ts, migrations/NNN_*.sql, repo.ts (settings, artifacts, prices_daily, job_runs)
  <domain>/      portfolio · quant · marketdata · macro · ai · ml — each exports `router` from router.ts
  services/      yahoo-finance.service.ts (live quotes/history)
  data/          static curated datasets (liquidity constants, market events), NOT the marketdata domain
src/
  app/           router.tsx (composes feature routes), nav.ts (IA), AppShell, TopBar, theme.tsx, page.tsx (lazy wrapper)
  design/        tokens.ts (PALETTE of CSS vars, TIER, signColor, cssVar()), format.ts (all number/date formatting)
  ui/            primitives: Panel, Stat, Chip, DataTable, PageHeader, Segmented, RouteTabs, Explainer/HelpTip, EmptyState/NotConfiguredState, Field/Input/Select, Skeleton/ErrorNote
  features/<domain>/  routes.tsx + pages/components/hooks for: overview, portfolio, markets, quant, macro, intelligence, data, investor, settings
  hooks/         useQuote, useAutoRefresh (shared by TopBar/Overview; COMEX-hours aware)
```

### Conventions that span files
- **Adding a server domain:** create `server/<domain>/router.ts`, then mount it in `server/routes/index.ts`. Server-internal relative imports must end in `.js` (ESM), even for `.ts` files.
- **Adding a client section:** create `src/features/<x>/routes.tsx` exporting `routes: RouteObject[]`, then spread it in `src/app/router.tsx` and add a nav entry in `src/app/nav.ts`. Pages are `lazy()` and wrapped with `page()`.
- **Migrations:** numbered SQL files applied once, in order, inside a transaction. Ranges are reserved per domain: 001–009 core, 010 portfolio, 020 quant, 030 marketdata, 040 macro/ai, 050 ml, 060 markets. Never edit an applied migration; add a new one.
- **Data flow on the client:** axios `src/api/client.ts` (baseURL `/api`, proxied by Vite to 3001) → TanStack Query hooks inside the feature. Query keys are feature-local arrays, prefixed with the domain name.
- **Unconfigured integrations:** responses for a missing integration are `NotConfigured` (`shared/api.ts`); render them with `NotConfiguredState` / `isNotConfigured`. Any figure that is estimated carries `Provenance.modeled = true` and shows a "Modeled" chip.
- **Styling:**
  - Colours come from OKLCH CSS variables in `src/styles/index.css`, which define light (`:root`) and dark (`.dark`, the default) themes.
  - Use the semantic utilities (`bg-surface`, `text-muted`, `text-pos-text`, `border-border`, `chip-*` classes). Never use raw hex values or Tailwind's gray palette in new code.
  - Numbers use the `.num` class (tabular mono); small-caps labels use `.label`; headlines use `.display` (Fraunces serif).
  - SVG charts pass `PALETTE.*` via `style`, because attributes don't resolve `var()`. Canvas charts (lightweight-charts) resolve colours with `cssVar()` and must re-resolve when the theme changes.
- **Formatting:** all number and date formatting goes through `src/design/format.ts` (em dash for missing values, typographic minus).
- **Commits:** never add Claude or co-author attribution lines (the user's global rule).
