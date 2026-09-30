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
