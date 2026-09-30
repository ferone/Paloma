# Product: Gold Investment Dashboard

A decision and record-keeping platform for a fund investing in **gold and silver** through ETFs, COMEX futures and allocated physical bullion.

## Users
- **Manager/trader (operator).** Records every entry and exit, monitors NAV and risk, looks for relative-value trades (calendar spreads, butterflies, seasonality, the gold/silver ratio), reads the macro regime and asks the AI analyst for sourced briefs.
- **Investors.** Read-only factsheet: NAV per unit, performance, allocation, risk and commentary. Printable.

## Promises
- **Real data only.** Missing data produces an explicit empty or "not configured" state. Modeled figures (e.g. the liquidity source split, central-bank estimates) are always labelled "Modeled".
- **Look-ahead safe.** Backtests, seasonal windows and ML validation use only information available at each decision date. Out-of-sample status is shown as passed, failed or untested.
- **Transparent.** Scores break down into their drivers; every panel states its source and the date its data runs to.
- **Honest about limits.** Nothing is promissory. Simulations and projections are labelled as illustrations.
- **Advisory, not execution.** There is no live broker connection. Trades are entered manually or by CSV import.

## Sections
Overview · Portfolio (holdings, ledger, performance and risk, physical vault, scenarios) · Investor report · Markets · Quant Lab · Macro & AI · Intelligence (ML) · Data Center · Settings
