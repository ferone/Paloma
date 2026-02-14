import clsx from 'clsx'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = {
  sm: 'w-4 h-4',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <div className={clsx('border-2 border-gold-400 border-t-transparent rounded-full animate-spin', sizes[size], className)} />
  )
}

export function LoadingState() {
  return (
    <div className="flex items-center justify-center h-64">
      <Spinner size="lg" />
    </div>
  )
}
