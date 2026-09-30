-- Generic CFTC Commitments of Traders positions, one row per market, report
-- family, report date and trader category. Two families share this table:
--   disagg  disaggregated futures-only (commodities): prod, swap, mm, other, nonrep
--   tff     Traders in Financial Futures futures-only (financials, incl. bitcoin):
--           dealer, asset_mgr, lev_money, other, nonrep
-- cot_reports (040) is still written for the disaggregated family, so readers
-- of the wide table keep working unchanged.
CREATE TABLE cot_positions (
  market        TEXT NOT NULL,          -- AssetSpec.cot.market (GOLD, SILVER, BTC, ...)
  report        TEXT NOT NULL CHECK (report IN ('disagg', 'tff')),
  report_date   TEXT NOT NULL,          -- positions as of (Tuesday)
  published_at  TEXT,                   -- release timestamp, for look-ahead safety
  open_interest REAL,
  category      TEXT NOT NULL,
  long          REAL,
  short         REAL,
  PRIMARY KEY (market, report, report_date, category)
);

-- Backfill the disaggregated history already stored in cot_reports.
INSERT INTO cot_positions (market, report, report_date, published_at, open_interest, category, long, short)
SELECT market, 'disagg', report_date, published_at, open_interest, 'prod', prod_long, prod_short FROM cot_reports
UNION ALL
SELECT market, 'disagg', report_date, published_at, open_interest, 'swap', swap_long, swap_short FROM cot_reports
UNION ALL
SELECT market, 'disagg', report_date, published_at, open_interest, 'mm', mm_long, mm_short FROM cot_reports
UNION ALL
SELECT market, 'disagg', report_date, published_at, open_interest, 'other', other_long, other_short FROM cot_reports
UNION ALL
SELECT market, 'disagg', report_date, published_at, open_interest, 'nonrep', nonrep_long, nonrep_short FROM cot_reports;
