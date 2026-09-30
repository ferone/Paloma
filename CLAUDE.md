# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Paloma is a gold/ETF market dashboard: a React 19 + Vite SPA (`src/`) backed by a small Express 5 API (`server/`) that proxies Yahoo Finance.

## Commands

```bash
npm run dev          # Vite (5173) + API server (3001, tsx watch) concurrently
npm run dev:client   # Vite only
npm run dev:server   # API only
npm run build        # tsc -b (client + vite config only) && vite build
npm run lint         # eslint over the whole repo
npx tsc -p tsconfig.server.json --noEmit   # type-check the server
```

- There is no test framework. Verify changes by running `npm run dev` and exercising the page or hitting the endpoint (e.g. `curl localhost:3001/api/gold-liquidity/history?range=1Y`).
- `npm run build` does **not** type-check `server/` — the root `tsconfig.json` only references `tsconfig.app.json` and `tsconfig.node.json`. Run the server tsc command above after server changes.
- Env: copy `.env.example` to `.env`. `PORT` defaults to 3001. `ALPHA_VANTAGE_API_KEY` is only read by `server/services/alpha-vantage.service.ts`, which is currently not wired into any route.

## Architecture

### Request flow
Browser → axios (`src/api/client.ts`, baseURL `/api`) → Vite dev proxy (`vite.config.ts`, `/api` → `localhost:3001`) → Express route → `yahoo-finance.service.ts` → Yahoo Finance.

### Server (`server/`)
- ESM with `"type": "module"`: relative imports inside `server/` must use the `.js` extension (e.g. `'./routes/quotes.js'`) even though the files are `.ts`.
- `index.ts` mounts one router per resource under `/api/*`, with a global rate limiter (100 req/min).
- `middleware/cache.ts` is an in-memory `node-cache` keyed on `req.originalUrl`, applied per route as `cacheMiddleware('quote' | 'intraday' | 'daily' | 'gold')`. It works by wrapping `res.json`, so a route must respond via `res.json()` for caching to work. Add new TTL keys to the `TTL` object.
- `services/yahoo-finance.service.ts` normalizes Yahoo responses (`getQuote`, `getBatchQuotes` using `Promise.allSettled` so failed symbols are dropped silently, `getHistorical`). Time ranges (`1D`…`ALL`) map to Yahoo periods here, and to intervals in `routes/historical.ts`.
- Gold liquidity (`routes/gold-liquidity.ts`, `routes/gold-liquidity-history.ts`):
  - Real data: dollar volume from Yahoo across `GOLD_INSTRUMENTS` (`GC=F`, GLD, IAU, SGOL, GDX). Futures dollar volume = `volume × 100 oz × price`; ETFs = `volume × price`.
  - **Modeled data**: the source breakdown (institutional, central banks, …) and region/country splits are *fixed percentages* from `data/gold-constants.ts` applied to the real total. They are not live data.
  - The history route detects volume spikes (>1.2σ above the mean, top 6) and annotates each one with the nearest curated event (within 3 days) from `data/market-events.ts`. Extend that file to explain new spikes.
- `/api/gold-liquidity/history` is mounted after `/api/gold-liquidity`. It works because the parent router only defines `GET /`.

### Client (`src/`)
- `App.tsx`: React Router with lazily loaded pages under `AppShell`, each wrapped in `ErrorBoundary` + `Suspense`. Pages: Dashboard (`/`), Comparison, Signals (`/signals/:symbol?`), Simulator, Liquidity.
- Data layer pattern: `api/*.api.ts` (axios fetchers) → `api/query-keys.ts` (central TanStack Query key factory) → `hooks/use*.ts` (one `useQuery` hook per resource) → components. Add new endpoints through all three layers.
- Auto-refresh: `SettingsProvider` (`store/settings-context.tsx`) holds a global `autoRefresh` toggle. Hooks get their `refetchInterval` from `useAutoRefresh()` (`lib/date-utils.getRefreshInterval`). Global query defaults are in `store/query-client.ts`.
- Response types live in `src/types/index.ts` and are maintained by hand to match the server's JSON shapes. Nothing is shared with `server/`, so update both sides when a response shape changes.
- Computation is done client-side in `lib/`: technical indicators (SMA/EMA/RSI…), portfolio simulation math, and series normalization for comparisons.
- Charts: `lightweight-charts` for price/candlestick charts, `recharts` for other visualizations (liquidity, comparison, simulator).
- Styling: Tailwind v4 via `@tailwindcss/vite`. The custom `gold-*` palette is defined in `@theme` in `src/styles/index.css`. The UI is dark-only. Per-symbol colors and the ETF lists are in `src/lib/constants.ts`.
- The client tsconfig is strict, with `noUnusedLocals`/`noUnusedParameters` and `verbatimModuleSyntax`, so use `import type` for type-only imports.
