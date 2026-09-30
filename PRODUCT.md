# Product: Real Assets Dashboard

A decision and record-keeping platform for a fund investing in **real assets** through ETFs, listed futures, allocated physical holdings and custody balances:
- **Precious metals:** gold and silver today; platinum and palladium next (COMEX/NYMEX futures, physically backed ETFs, vaulted bullion).
- **Industrial metals:** copper (COMEX HG, quoted in $/lb).
- **Digital assets:** bitcoin (24/7 spot, CME futures, spot ETFs, custody balances).

Every asset is defined once in the universe (`shared/universe.ts`); adding one is a data change, not a code change.

## Users
- **Manager/trader (operator).** Records every entry and exit, monitors NAV and risk, looks for relative-value trades (calendar spreads, butterflies, seasonality, cross-asset ratios such as gold/silver), reads the macro regime and asks the AI analyst for sourced briefs.
- **Investors.** Read-only factsheet: NAV per unit, performance, allocation, risk and commentary. Printable.

## Promises
- **Real data only.** Missing data produces an explicit empty or "not configured" state; so does an asset without futures, ETFs or miners. Modeled figures (e.g. the gold liquidity source split, central-bank estimates) are always labelled "Modeled".
- **Look-ahead safe.** Backtests, seasonal windows and ML validation use only information available at each decision date. Out-of-sample status is shown as passed, failed or untested.
- **Transparent.** Scores break down into their drivers; every panel states its source and the date its data runs to.
- **Honest about limits.** Nothing is promissory. Simulations and projections are labelled as illustrations.
- **Advisory, not execution.** There is no live broker connection. Trades are entered manually or by CSV import.

## Sections
Overview · Portfolio (holdings, ledger, performance and risk, physical vault, scenarios) · Investor report · Markets · Quant Lab · Macro & AI · Intelligence (ML) · Data Center · Settings

The asset in focus is chosen once in the top bar and drives Markets, Quant Lab, Macro and Intelligence. The top-bar ticker strip is configurable (every asset and ratio by default).
