import clsx from 'clsx'
import { RiArrowUpSFill, RiArrowDownSFill } from 'react-icons/ri'
import { formatPercent } from '../../lib/format'

interface PercentChangeProps {
  value: number
  className?: string
  showIcon?: boolean
}

export function PercentChange({ value, className, showIcon = true }: PercentChangeProps) {
  const isPositive = value >= 0

  return (
    <span
      className={clsx(
        'inline-flex items-center font-medium',
        isPositive ? 'text-green-400' : 'text-red-400',
        className
      )}
    >
      {showIcon && (isPositive ? <RiArrowUpSFill size={18} /> : <RiArrowDownSFill size={18} />)}
      {formatPercent(value)}
    </span>
  )
}
