import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NotConfigured } from '@shared/api'
import type { Metal } from '@shared/universe'
import type { CorrelationResponse, CotMarket, CotResponse, MacroDashboard, RefreshResponse, SeriesResponse } from '@shared/macro'
import type { AiModelsResponse, AiReport, AiReportSummary, AiSettings, AiStatus, ReportRequest } from '@shared/ai'
import { api } from '../../api/client'

// TanStack Query hooks for /api/macro and /api/ai. Keys are prefixed 'macro'.

export function useMacroDashboard(metal: Metal) {
  return useQuery({
    queryKey: ['macro', 'dashboard', metal],
    queryFn: async () => (await api.get<MacroDashboard>('/macro/dashboard', { params: { metal } })).data,
    placeholderData: keepPreviousData,
    // Poll while a refresh job is running so the page updates when it lands.
    refetchInterval: (q) => {
      const r = q.state.data?.refresh
      return r && [r.fred, r.cot, r.all].some((j) => j?.state === 'running') ? 3000 : false
    },
  })
}

export function useMacroSeries(ids: string[], from: string) {
  return useQuery({
    queryKey: ['macro', 'series', ids.join(','), from],
    queryFn: async () => (await api.get<SeriesResponse>('/macro/series', { params: { ids: ids.join(','), from } })).data,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })
}

export function useCot(market: CotMarket) {
  return useQuery({
    queryKey: ['macro', 'cot', market],
    queryFn: async () => (await api.get<CotResponse>('/macro/cot', { params: { market } })).data,
    staleTime: 5 * 60_000,
  })
}

export function useCorrelations(metal: Metal, window: number) {
  return useQuery({
    queryKey: ['macro', 'correlations', metal, window],
    queryFn: async () => (await api.get<CorrelationResponse>('/macro/correlations', { params: { metal, window } })).data,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })
}

export function useMacroRefresh() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (what: 'all' | 'fred' | 'cot' = 'all') => (await api.post<RefreshResponse>('/macro/refresh', { what })).data,
    onSettled: () => qc.invalidateQueries({ queryKey: ['macro'] }),
  })
}

// ── AI ─────────────────────────────────────────────────────────────────────

export function useAiStatus() {
  return useQuery({ queryKey: ['macro', 'ai', 'status'], queryFn: async () => (await api.get<AiStatus>('/ai/status')).data })
}

export function useAiModels() {
  return useQuery({
    queryKey: ['macro', 'ai', 'models'],
    queryFn: async () => (await api.get<AiModelsResponse>('/ai/models', { timeout: 30_000 })).data,
    staleTime: 60 * 60_000,
  })
}

export function useSaveAiSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (s: Partial<AiSettings>) => (await api.put<AiSettings>('/ai/settings', s)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['macro', 'ai', 'status'] }),
  })
}

export function useReports() {
  return useQuery({
    queryKey: ['macro', 'ai', 'reports'],
    queryFn: async () => (await api.get<AiReportSummary[]>('/ai/reports')).data,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'running') ? 3000 : false),
  })
}

export function useReport(id: number | null) {
  return useQuery({
    queryKey: ['macro', 'ai', 'report', id],
    enabled: id != null,
    queryFn: async () => (await api.get<AiReport>(`/ai/reports/${id}`)).data,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 2500 : false),
  })
}

export function useGenerateReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (req: ReportRequest) => (await api.post<AiReport | NotConfigured>('/ai/reports', req)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['macro', 'ai', 'reports'] }),
  })
}

export function useDeleteReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => api.delete(`/ai/reports/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['macro', 'ai', 'reports'] }),
  })
}

/** Axios error → readable message (server `{ error }` bodies included). */
export function errorMessage(err: unknown): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string }
  return e?.response?.data?.error ?? e?.message ?? 'Request failed'
}
