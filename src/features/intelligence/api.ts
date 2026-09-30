import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { JobStatus } from '@shared/api'
import type { MlPredictionsResponse, MlRunDetail, MlRunSummary, MlStatus } from '@shared/ml'
import type { Metal } from '@shared/universe'
import { api } from '../../api/client'

// TanStack Query hooks for /api/ml. Keys are prefixed with 'ml'.

export const mlKeys = {
  all: ['ml'] as const,
  status: ['ml', 'status'] as const,
  predictions: ['ml', 'predictions'] as const,
  runs: (metal: Metal) => ['ml', 'runs', metal] as const,
  run: (id: number) => ['ml', 'run', id] as const,
  jobs: ['ml', 'jobs'] as const,
}

export function useMlStatus() {
  return useQuery({ queryKey: mlKeys.status, queryFn: async () => (await api.get<MlStatus>('/ml/status')).data })
}

export function useMlPredictions() {
  return useQuery({
    queryKey: mlKeys.predictions,
    queryFn: async () => (await api.get<MlPredictionsResponse>('/ml/predictions')).data.predictions,
  })
}

export function useMlRuns(metal: Metal) {
  return useQuery({
    queryKey: mlKeys.runs(metal),
    queryFn: async () => (await api.get<MlRunSummary[]>('/ml/runs', { params: { metal } })).data,
  })
}

export function useMlRun(id: number | null | undefined) {
  return useQuery({
    queryKey: mlKeys.run(id ?? -1),
    enabled: id != null,
    queryFn: async () => (await api.get<MlRunDetail>(`/ml/runs/${id}`)).data,
    staleTime: Infinity, // a finished run never changes
  })
}

/** The latest successful run for a metal, with full metrics. */
export function useLatestRun(metal: Metal) {
  const runs = useMlRuns(metal)
  const latest = runs.data?.find((r) => r.status === 'succeeded') ?? null
  const detail = useMlRun(latest?.id)
  return {
    run: detail.data ?? null,
    isLoading: runs.isLoading || (latest != null && detail.isLoading),
    error: runs.error ?? detail.error,
    refetch: () => {
      void runs.refetch()
      void detail.refetch()
    },
  }
}

type JobRow = JobStatus & { description: string }

/** Live status of the ml.* jobs; polls every 2 s while one is running. */
export function useMlJobs() {
  const qc = useQueryClient()
  return useQuery({
    queryKey: mlKeys.jobs,
    queryFn: async () => {
      const jobs = (await api.get<JobRow[]>('/jobs')).data.filter((j) => j.name.startsWith('ml.'))
      const prev = qc.getQueryData<JobRow[]>(mlKeys.jobs)
      // When a job finishes, refresh everything the job may have written.
      const finished = jobs.some((j) => j.state !== 'running' && prev?.find((p) => p.name === j.name)?.state === 'running')
      if (finished) void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'ml' && q.queryKey[1] !== 'jobs' })
      return jobs
    },
    refetchInterval: (q) => (q.state.data?.some((j) => j.state === 'running') ? 2000 : false),
  })
}

export function useStartMlJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { kind: 'train' | 'infer'; metal?: Metal }) =>
      (await api.post<JobStatus>(`/ml/${vars.kind}`, vars.metal ? { metal: vars.metal } : {})).data,
    onSettled: () => qc.invalidateQueries({ queryKey: mlKeys.jobs }),
  })
}
