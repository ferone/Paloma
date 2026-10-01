import clsx from 'clsx'
import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs pointer-coarse:h-10' : 'h-9 px-3.5 text-sm pointer-coarse:h-11',
        variant === 'primary' && 'bg-foreground text-background hover:bg-foreground/85',
        variant === 'secondary' && 'border border-border-strong bg-surface text-foreground hover:bg-surface-2',
        variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-foreground',
        variant === 'danger' && 'border border-neg/40 text-neg-text hover:bg-neg/10',
        className,
      )}
      {...rest}
    />
  )
}
