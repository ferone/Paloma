import clsx from 'clsx'

interface SegmentedProps<T extends string> {
  value: T
  options: readonly T[] | readonly { value: T; label: string }[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  ariaLabel: string
}

/** Segmented control for ranges, metals, chart modes. Keyboard: native buttons. */
export function Segmented<T extends string>({ value, options, onChange, size = 'sm', ariaLabel }: SegmentedProps<T>) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o as T, label: o as string } : o))
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex max-w-full overflow-x-auto rounded-md border border-border bg-surface-2 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'shrink-0 whitespace-nowrap rounded-[5px] font-medium transition-colors',
            size === 'sm' ? 'px-2 py-0.5 text-2xs pointer-coarse:px-3 pointer-coarse:py-2.5' : 'px-3 py-1 text-xs pointer-coarse:py-2',
            o.value === value ? 'bg-surface text-foreground shadow-sm ring-1 ring-border' : 'text-muted hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
