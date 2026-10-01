import clsx from 'clsx'
import { useMemo, useState, type ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: ReactNode
  /** Cell renderer. */
  cell: (row: T) => ReactNode
  /** Sort key; omit to make the column unsortable. */
  sortValue?: (row: T) => number | string | null
  /** Numeric columns are right-aligned and tabular. */
  numeric?: boolean
  className?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  empty?: ReactNode
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  onRowClick?: (row: T) => void
  dense?: boolean
  footer?: ReactNode
  caption?: string
}

/** Sortable, dense-capable table. Headers are small caps; numbers tabular + right-aligned. */
export function DataTable<T>({ columns, rows, rowKey, empty, initialSort, onRowClick, dense, footer, caption }: DataTableProps<T>) {
  const [sort, setSort] = useState(initialSort)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    const get = col.sortValue
    return [...rows].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      if (va == null) return 1
      if (vb == null) return -1
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [rows, sort, columns])

  const cellPad = dense ? 'px-2 py-1.5' : 'px-3 py-2.5'

  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => {
              const active = sort?.key === c.key
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={clsx('label whitespace-nowrap font-medium', cellPad, c.numeric ? 'text-right' : 'text-left')}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 uppercase hover:text-foreground pointer-coarse:min-h-9"
                      onClick={() =>
                        setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))
                      }
                    >
                      {c.header}
                      <span aria-hidden className={clsx('text-[9px]', active ? 'text-foreground' : 'text-transparent')}>
                        {sort?.dir === 'asc' ? '▲' : '▼'}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-10 text-center text-sm text-muted">
                {empty ?? 'No rows.'}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={clsx(
                  'border-b border-border/60 last:border-0',
                  onRowClick && 'cursor-pointer hover:bg-surface-2',
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={clsx(cellPad, c.numeric && 'num text-right', c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer && <tfoot className="border-t border-border-strong">{footer}</tfoot>}
      </table>
    </div>
  )
}
