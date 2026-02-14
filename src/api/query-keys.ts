export const queryKeys = {
  quotes: {
    all: ['quotes'] as const,
    single: (symbol: string) => ['quotes', symbol] as const,
    batch: (symbols: string[]) => ['quotes', 'batch', ...symbols] as const,
  },
  historical: {
    all: ['historical'] as const,
    symbol: (symbol: string, range: string) => ['historical', symbol, range] as const,
  },
  gold: {
    price: ['gold', 'price'] as const,
    liquidity: ['gold', 'liquidity'] as const,
  },
} as const
