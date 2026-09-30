import clsx from 'clsx'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

const control =
  'w-full rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-faint focus:border-brand focus:outline-none disabled:opacity-60'

export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="label mb-1 block">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-2xs text-neg-text">{error}</span> : hint ? <span className="mt-1 block text-2xs text-muted">{hint}</span> : null}
    </label>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(control, rest.type === 'number' && 'num', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(control, 'pr-8', className)} {...rest}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(control, 'min-h-20', className)} {...rest} />
}
