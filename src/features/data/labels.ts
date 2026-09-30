// Human labels for datasets and sources shown across the Data Center.

export const DATASET_LABEL: Record<string, { label: string; detail: string }> = {
  prices_daily: { label: 'Daily prices', detail: 'Futures fronts, ETFs, miners, macro references; Databento continuous front months' },
  contracts: { label: 'Futures contracts', detail: 'GC · MGC · SI · SIL contract months with last-trade and first-notice dates' },
  contract_bars: { label: 'Contract bars', detail: 'Daily OHLCV and open interest per contract month' },
  macro_series: { label: 'Macro series', detail: 'FRED and derived series (real yields, dollar, ratios)' },
  cot_reports: { label: 'CFTC positioning', detail: 'Disaggregated Commitments of Traders, weekly' },
  pf_transactions: { label: 'Transactions', detail: 'Portfolio ledger' },
  pf_nav_snapshots: { label: 'NAV snapshots', detail: 'Daily fund NAV' },
  pf_physical_items: { label: 'Physical holdings', detail: 'Allocated bullion items' },
  pf_fund_units: { label: 'Fund units', detail: 'Unit issues and cancellations at NAV/unit' },
  ai_reports: { label: 'AI reports', detail: 'Generated briefs and commentary' },
  ml_predictions: { label: 'ML predictions', detail: 'Model outputs per instrument' },
  ml_runs: { label: 'ML runs', detail: 'Training and validation runs' },
}

export function datasetLabel(name: string): string {
  return DATASET_LABEL[name]?.label ?? name
}

export const SOURCE_LABEL: Record<string, string> = {
  yahoo: 'Yahoo Finance',
  databento: 'Databento GLBX.MDP3',
  fred: 'FRED',
  cftc: 'CFTC',
  derived: 'Derived',
}

export function sourceLabel(s: string): string {
  return s === '—' ? '—' : (SOURCE_LABEL[s] ?? s)
}

export const ARTIFACT_LABEL: Record<string, string> = {
  'portfolio:summary': 'Portfolio summary',
  'quant:snapshot': 'Quant snapshot',
  'ml:predictions': 'ML predictions',
  'macro:dashboard': 'Macro dashboard',
}
