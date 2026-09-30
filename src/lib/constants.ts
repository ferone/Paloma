// @deprecated Kept only for the pre-redesign simulator; the instrument universe
// lives in shared/universe.ts. Delete once the portfolio workstream's replacement lands.
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
}
