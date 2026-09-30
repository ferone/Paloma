import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { api } from '../../api/client'
import type {
  Account,
  AccountInput,
  AttributionResponse,
  BenchmarkId,
  HoldingsResponse,
  ImportBatch,
  ImportCommitRequest,
  ImportCommitResponse,
  ImportPreviewRequest,
  ImportPreviewResponse,
  Instrument,
  NavSeriesResponse,
  PerformanceResponse,
  PhysicalItem,
  PhysicalItemInput,
  PortfolioSettingsResponse,
  PortfolioSummary,
  RiskResponse,
  SettingsInput,
  Transaction,
  TransactionInput,
  TransactionsQuery,
  UnitsResponse,
  VaultResponse,
} from '@shared/portfolio'

// TanStack Query hooks for /api/portfolio. Every mutation invalidates the whole
// ['portfolio'] tree because any ledger change can move every figure.
const KEY = 'portfolio'
// NAV recompute can fetch closes on a cold cache.
const SLOW = { timeout: 60_000 }

const get = <T,>(url: string, params?: object) => api.get<T>(`/portfolio${url}`, { params, ...SLOW }).then((r) => r.data)

export function useSummary() {
  return useQuery({ queryKey: [KEY, 'summary'], queryFn: () => get<PortfolioSummary>('/summary') })
}
export function useHoldings() {
  return useQuery({ queryKey: [KEY, 'holdings'], queryFn: () => get<HoldingsResponse>('/holdings') })
}
export function usePerformance(benchmark: BenchmarkId, from?: string) {
  return useQuery({
    queryKey: [KEY, 'performance', benchmark, from ?? null],
    queryFn: () => get<PerformanceResponse>('/performance', { benchmark, from }),
    placeholderData: keepPreviousData,
  })
}
export function useRisk() {
  return useQuery({ queryKey: [KEY, 'risk'], queryFn: () => get<RiskResponse>('/risk') })
}
export function useAttribution(from?: string) {
  return useQuery({
    queryKey: [KEY, 'attribution', from ?? null],
    queryFn: () => get<AttributionResponse>('/attribution', { from }),
    placeholderData: keepPreviousData,
  })
}
export function useNavSeries() {
  return useQuery({ queryKey: [KEY, 'nav'], queryFn: () => get<NavSeriesResponse>('/nav') })
}
export function useUnits() {
  return useQuery({ queryKey: [KEY, 'units'], queryFn: () => get<UnitsResponse>('/units') })
}
export function useVault() {
  return useQuery({ queryKey: [KEY, 'vault'], queryFn: () => get<VaultResponse>('/vault') })
}
export function useTransactions(q: TransactionsQuery) {
  return useQuery({
    queryKey: [KEY, 'transactions', q],
    queryFn: () => get<Transaction[]>('/transactions', q),
    placeholderData: keepPreviousData,
  })
}
export function useAccounts() {
  return useQuery({ queryKey: [KEY, 'accounts'], queryFn: () => get<Account[]>('/accounts') })
}
export function useInstruments() {
  return useQuery({ queryKey: [KEY, 'instruments'], queryFn: () => get<Instrument[]>('/instruments'), staleTime: Infinity })
}
export function useBatches() {
  return useQuery({ queryKey: [KEY, 'batches'], queryFn: () => get<ImportBatch[]>('/import/batches') })
}
export function usePortfolioSettings() {
  return useQuery({ queryKey: [KEY, 'settings'], queryFn: () => get<PortfolioSettingsResponse>('/settings') })
}

function useInvalidating<TVars, TData>(fn: (v: TVars) => Promise<TData>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }) })
}

const send = <T,>(method: 'post' | 'put' | 'delete', url: string, body?: unknown) =>
  api.request<T>({ method, url: `/portfolio${url}`, data: body, ...SLOW }).then((r) => r.data)

export const useSaveTransaction = () =>
  useInvalidating(({ id, body }: { id?: number; body: TransactionInput }) => send<Transaction>(id ? 'put' : 'post', id ? `/transactions/${id}` : '/transactions', body))
export const useDeleteTransaction = () => useInvalidating((id: number) => send<void>('delete', `/transactions/${id}`))
export const useSaveAccount = () =>
  useInvalidating(({ id, body }: { id?: number; body: AccountInput }) => send<Account>(id ? 'put' : 'post', id ? `/accounts/${id}` : '/accounts', body))
export const useDeleteAccount = () => useInvalidating((id: number) => send<void>('delete', `/accounts/${id}`))
export const useSavePhysical = () =>
  useInvalidating(({ id, body }: { id?: number; body: PhysicalItemInput }) => send<PhysicalItem>(id ? 'put' : 'post', id ? `/physical/${id}` : '/physical', body))
export const useDeletePhysical = () => useInvalidating((id: number) => send<void>('delete', `/physical/${id}`))
export const useImportCommit = () => useInvalidating((body: ImportCommitRequest) => send<ImportCommitResponse>('post', '/import/commit', body))
export const useRollbackBatch = () => useInvalidating((id: string) => send<unknown>('post', `/import/${encodeURIComponent(id)}/rollback`))
export const useSaveSettings = () => useInvalidating((body: SettingsInput) => send<PortfolioSettingsResponse>('put', '/settings', body))

export function useImportPreview() {
  return useMutation({ mutationFn: (body: ImportPreviewRequest) => send<ImportPreviewResponse>('post', '/import/preview', body) })
}

/** Human message from an API error (zod issues joined), for inline form errors. */
export function apiErrorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    const data = err.response?.data as { error?: string; issues?: { path: string; message: string }[] } | undefined
    if (data?.issues?.length) return data.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join(' · ')
    if (data?.error) return data.error
    return err.message
  }
  return err instanceof Error ? err.message : 'Request failed'
}

export function exportUrl(q: TransactionsQuery): string {
  const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]))
  const qs = params.toString()
  return `/api/portfolio/export.csv${qs ? `?${qs}` : ''}`
}
