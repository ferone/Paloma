export const GOLD_ETFS = ['GLD', 'IAU', 'SGOL', 'GDX'] as const
export const MARKET_ETFS = ['SPY', 'QQQ', 'VOO', 'VTI', 'DIA'] as const
export const ALL_ETFS = [...GOLD_ETFS, ...MARKET_ETFS] as const

export const ETF_COLORS: Record<string, string> = {
  GLD: '#eab308',
  IAU: '#f59e0b',
  SGOL: '#d97706',
  GDX: '#b45309',
  SPY: '#3b82f6',
  QQQ: '#8b5cf6',
  VOO: '#06b6d4',
  VTI: '#10b981',
  DIA: '#ec4899',
  'GC=F': '#fbbf24',
}

export const TIME_RANGES = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y', 'ALL'] as const
export type TimeRange = (typeof TIME_RANGES)[number]

export const CHART_COLORS = {
  up: '#22c55e',
  down: '#ef4444',
  gold: '#eab308',
  gridLine: '#1f2937',
  text: '#9ca3af',
  background: '#030712',
  cardBg: '#111827',
  border: '#1f2937',
} as const
