import clsx from 'clsx'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div className={clsx('animate-pulse bg-gray-800 rounded', className)} />
  )
}

export function CardSkeleton() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-4 w-20" />
    </div>
  )
}

export function ChartSkeleton() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <Skeleton className="h-80 w-full" />
    </div>
  )
}
