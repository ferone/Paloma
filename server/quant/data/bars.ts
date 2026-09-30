/**
 * One daily bar of a SPECIFIC contract as the data layer combines it. Mirrors
 * the subset of `ContractBar` (server/db/shared-repo.ts) the pure combiners
 * need; `instrumentId` is optional (Databento's per-contract id, when known).
 */
export interface DailyBar {
  date: string; // YYYY-MM-DD
  symbol?: string;
  instrumentId?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
