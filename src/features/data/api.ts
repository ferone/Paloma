import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import type { IntegrationStatus, JobStatus, NotConfigured } from '@shared/api'
import type {
  BackfillRequest,
  CostEstimate,
  DatabentoRoot,
  DatabentoSchema,
  DatabentoSpend,
  EstimateRequest,
  FreshnessResponse,
  JobRunRow,
  OverBudgetBody,
  ScheduleConfig,
  ScheduleStatus,
  SymbolListRow,
} from '@shared/marketdata'
import { api } from '../../api/client'

// Data Center queries. Keys are prefixed with the domain name.
export const dataKeys = {
  freshness: ['marketdata', 'freshness'] as const,
  databento: ['marketdata', 'databento'] as const,
  jobs: ['marketdata', 'jobs'] as const,
  runs: ['marketdata', 'runs'] as const,
  schedule: ['marketdata', 'schedule'] as const,
  symbols: ['marketdata', 'symbols'] as const,
  artifacts: ['marketdata', 'artifacts'] as const,
  status: ['status'] as const,
}

export type RegisteredJob = JobStatus & { description: string }

export interface DatabentoStatus {
  configured: boolean
  budget: number
  roots: DatabentoRoot[]
  schemas: DatabentoSchema[]
  historyStart: string
  spend: DatabentoSpend
  backfill: JobStatus | null
}

/** Human message from an axios error body ({ message } / { error }) or the Error itself. */
export function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as { message?: string; error?: string } | undefined
    return body?.message ?? body?.error ?? err.message
  }
  return err instanceof Error ? err.message : String(err)
}

export function useFreshness() {
  return useQuery({
    queryKey: dataKeys.freshness,
    queryFn: async () => (await api.get<FreshnessResponse>('/marketdata/freshness')).data,
    refetchInterval: 60_000,
  })
}

export function useIntegrationStatus() {
  return useQuery({ queryKey: dataKeys.status, queryFn: async () => (await api.get<IntegrationStatus>('/status')).data })
}

/** Databento config, spend and backfill job; polls every 2 s while a backfill runs. */
export function useDatabentoStatus() {
  return useQuery({
    queryKey: dataKeys.databento,
    queryFn: async () => (await api.get<DatabentoStatus>('/marketdata/databento/status')).data,
    refetchInterval: (q) => (q.state.data?.backfill?.state === 'running' ? 2000 : 30_000),
  })
}

/** Registered jobs; polls quickly while any job is running. */
export function useJobs() {
  return useQuery({
    queryKey: dataKeys.jobs,
    queryFn: async () => (await api.get<RegisteredJob[]>('/jobs')).data,
    refetchInterval: (q) => (q.state.data?.some((j) => j.state === 'running') ? 2000 : 15_000),
  })
}

export function useJobRuns(limit = 30) {
  return useQuery({
    queryKey: [...dataKeys.runs, limit],
    queryFn: async () => (await api.get<JobRunRow[]>('/marketdata/jobs/runs', { params: { limit } })).data,
    refetchInterval: 15_000,
  })
}

export function useRunJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => (await api.post<JobStatus>(`/jobs/${encodeURIComponent(name)}/run`, {})).data,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: dataKeys.jobs })
      qc.invalidateQueries({ queryKey: dataKeys.runs })
    },
  })
}

// get_cost over 16 years can take a minute on Databento's side.
const SLOW = { timeout: 180_000 }

export function useEstimate() {
  return useMutation({
    mutationFn: async (req: EstimateRequest) => (await api.post<CostEstimate | NotConfigured>('/marketdata/databento/estimate', req, SLOW)).data,
  })
}

export type BackfillOutcome = { kind: 'started'; job: JobStatus } | { kind: 'over_budget'; body: OverBudgetBody } | { kind: 'not_configured'; info: NotConfigured }

export function useBackfill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (req: BackfillRequest): Promise<BackfillOutcome> => {
      const res = await api.post('/marketdata/databento/backfill', req, { ...SLOW, validateStatus: (s) => s === 202 || s === 200 || s === 402 })
      if (res.status === 402) return { kind: 'over_budget', body: res.data as OverBudgetBody }
      if (res.status === 200) return { kind: 'not_configured', info: res.data as NotConfigured }
      return { kind: 'started', job: res.data as JobStatus }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: dataKeys.jobs })
      qc.invalidateQueries({ queryKey: dataKeys.databento })
    },
  })
}

export function useSchedule() {
  return useQuery({
    queryKey: dataKeys.schedule,
    queryFn: async () => (await api.get<ScheduleStatus>('/marketdata/schedule')).data,
    refetchInterval: 30_000,
  })
}

export function useSaveSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (cfg: ScheduleConfig) => (await api.put<ScheduleStatus>('/marketdata/schedule', cfg)).data,
    onSuccess: (data) => qc.setQueryData(dataKeys.schedule, data),
  })
}

export function useRunScheduleNow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => (await api.post<ScheduleStatus>('/marketdata/schedule/run')).data,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: dataKeys.schedule })
      qc.invalidateQueries({ queryKey: dataKeys.jobs })
    },
  })
}

export function useSymbols() {
  return useQuery({ queryKey: dataKeys.symbols, queryFn: async () => (await api.get<SymbolListRow[]>('/marketdata/symbols')).data })
}

export interface ArtifactAvailability {
  name: string
  generatedAt: string | null
  available: boolean
}

export function useArtifacts() {
  return useQuery({ queryKey: dataKeys.artifacts, queryFn: async () => (await api.get<ArtifactAvailability[]>('/marketdata/artifacts')).data })
}
