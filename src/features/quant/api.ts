import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { JobStatus } from '@shared/api'
import type { Metal } from '@shared/universe'
import {
  isQuantEmpty,
  type BacktestView,
  type CurveView,
  type GatesResponse,
  type InstrumentDetail,
  type InstrumentListItem,
  type OpportunitiesResponse,
  type QuantEmpty,
  type QuantMode,
  type QuantSnapshot,
  type RecomputeResponse,
  type RelativeValueDetail,
  type SeasonalityDetail,
} from '@shared/quant'
import { api } from '../../api/client'

// TanStack Query hooks for /api/quant. Every data query may resolve to a
// QuantEmpty state; while the engine is computing they poll until it finishes.

export type Maybe<T> = T | QuantEmpty

function useQuant<T>(key: unknown[], url: string, enabled = true) {
  return useQuery({
    queryKey: ['quant', ...key],
    queryFn: async () => (await api.get<Maybe<T>>(url, { timeout: 30_000 })).data,
    enabled,
    refetchInterval: (q) => (isQuantEmpty(q.state.data) && q.state.data.status === 'computing' ? 4000 : false),
  })
}

export const useSnapshot = (metal: Metal) => useQuant<QuantSnapshot>(['snapshot', metal], `/quant/snapshot?metal=${metal}`)
export const useOpportunities = (metal: Metal, mode: QuantMode) =>
  useQuant<OpportunitiesResponse>(['opportunities', metal, mode], `/quant/opportunities?metal=${metal}&mode=${mode}`)
export const useInstruments = (metal: Metal) => useQuant<InstrumentListItem[]>(['instruments', metal], `/quant/instruments?metal=${metal}`)
export const useInstrument = (id: string | undefined) =>
  useQuant<InstrumentDetail>(['instrument', id], `/quant/instrument/${encodeURIComponent(id ?? '')}`, !!id)
export const useSeasonality = (id: string | undefined) =>
  useQuant<SeasonalityDetail>(['seasonality', id], `/quant/seasonality/${encodeURIComponent(id ?? '')}`, !!id)
export const useRelativeValue = () => useQuant<RelativeValueDetail>(['relative-value'], '/quant/relative-value?pair=gold-silver')
export const useCurve = (root: string) => useQuant<CurveView>(['curve', root], `/quant/curve/${root}`)
export const useBacktest = (metal: Metal, mode: QuantMode) => useQuant<BacktestView>(['backtest', metal, mode], `/quant/backtest?metal=${metal}&mode=${mode}`)
export const useGates = (metal: Metal) => useQuant<GatesResponse>(['gates', metal], `/quant/gates?metal=${metal}`)

export interface QuantStatus {
  run: { id: number; generatedAt: string; dataThrough: string | null; instruments: number; durationMs: number | null } | null
  job: JobStatus | null
  hasData: boolean
}

/** Engine run + job status; polls while the job runs and refreshes every quant query when it finishes. */
export function useQuantStatus() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['quant-status'],
    queryFn: async () => (await api.get<QuantStatus>('/quant/status')).data,
    refetchInterval: (s) => (s.state.data?.job?.state === 'running' ? 3000 : 60_000),
  })
  const prev = useRef<string | undefined>(undefined)
  const state = q.data?.job?.state
  useEffect(() => {
    if (prev.current === 'running' && state && state !== 'running') void qc.invalidateQueries({ queryKey: ['quant'] })
    prev.current = state
  }, [state, qc])
  return q
}

export function useRecompute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => (await api.post<RecomputeResponse>('/quant/recompute', undefined, { validateStatus: (s) => s === 202 || s === 409 })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quant-status'] })
      void qc.invalidateQueries({ queryKey: ['quant'] })
    },
  })
}
