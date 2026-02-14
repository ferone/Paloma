import clsx from 'clsx'
import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={clsx('bg-gray-900 border border-gray-800 rounded-xl', className)}>
      {children}
    </div>
  )
}
