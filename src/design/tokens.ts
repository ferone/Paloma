import type { Metal } from '@shared/universe'

// Presentation tokens for charts and semantic colouring. Values are CSS
// variables so they flip with the theme. SVG presentation *attributes* don't
// expand var(), so pass these via `style` (e.g. style={{ stroke: PALETTE.brand }}).
export const PALETTE = {
  brand: 'var(--brand)',
  foreground: 'var(--foreground)',
  muted: 'var(--muted)',
  faint: 'var(--faint)',
  border: 'var(--border)',
  surface: 'var(--surface)',
  surface2: 'var(--surface-2)',
  pos: 'var(--pos)',
  neg: 'var(--neg)',
  gold: 'var(--metal-gold)',
  silver: 'var(--metal-silver)',
  modeled: 'var(--modeled)',
  series: ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'],
} as const

export const METAL_COLOR: Record<Metal, string> = {
  gold: PALETTE.gold,
  silver: PALETTE.silver,
}

/**
 * Resolve a CSS variable to a concrete colour string. Needed for canvas-based
 * libraries (lightweight-charts) and recharts gradients, which can't read var().
 * Re-resolve when the theme changes (useTheme().theme as an effect dependency).
 */
export function cssVar(name: string, el: Element = document.documentElement): string {
  const key = name.startsWith('var(') ? name.slice(4, -1) : name
  return getComputedStyle(el).getPropertyValue(key).trim()
}

export type Tier = 'STRONG' | 'MODERATE' | 'WATCH' | 'AVOID'

export const TIER: Record<Tier, { label: string; fill: string; text: string; chip: string }> = {
  STRONG: { label: 'Strong', fill: 'var(--tier-strong)', text: 'text-tier-strong-text', chip: 'chip-strong' },
  MODERATE: { label: 'Moderate', fill: 'var(--tier-moderate)', text: 'text-tier-moderate-text', chip: 'chip-moderate' },
  WATCH: { label: 'Watch', fill: 'var(--tier-watch)', text: 'text-tier-watch-text', chip: 'chip-watch' },
  AVOID: { label: 'Avoid', fill: 'var(--tier-avoid)', text: 'text-tier-avoid-text', chip: 'chip-avoid' },
}

export const VALIDATION_CHIP: Record<'passed' | 'failed' | 'untested', string> = {
  passed: 'chip-strong',
  failed: 'chip-avoid',
  untested: 'chip-neutral',
}

/** Canonical gain/loss text colour. null → muted, zero → neutral. */
export function signColor(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'text-muted'
  return v > 0 ? 'text-pos-text' : v < 0 ? 'text-neg-text' : 'text-foreground/80'
}

/**
 * First-render size for recharts ResponsiveContainer. It measures its parent
 * after mount; without this it renders at -1×-1 once and logs a warning.
 */
export const CHART_INITIAL_SIZE = { width: 600, height: 240 } as const
