import clsx from 'clsx'
import type { ReactNode } from 'react'
import { signColor } from '../design/tokens'

interface StatProps {
  label: ReactNode
  value: ReactNode
  /** Signed change shown under the value; coloured by sign when `deltaValue` given. */
  delta?: ReactNode
  deltaValue?: number | null
  hint?: ReactNode
  /** `hero` uses the display serif (NAV, headline figures). */
  size?: 'sm' | 'md' | 'lg' | 'hero'
  align?: 'left' | 'right'
  className?: string
}

const VALUE_SIZE = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-[1.75rem] leading-tight',
  hero: 'display text-[clamp(2.25rem,4vw,3.25rem)] leading-none font-light',
} as const

export function Stat({ label, value, delta, deltaValue, hint, size = 'md', align = 'left', className }: StatProps) {
  return (
    <div className={clsx(align === 'right' && 'text-right', className)}>
      <div className="label">{label}</div>
      <div className={clsx('mt-1 text-foreground', size === 'hero' ? VALUE_SIZE.hero : ['num', VALUE_SIZE[size]])}>{value}</div>
      {delta != null && <div className={clsx('num mt-1 text-xs', signColor(deltaValue))}>{delta}</div>}
      {hint && <div className="mt-1 text-2xs text-muted">{hint}</div>}
    </div>
  )
}
