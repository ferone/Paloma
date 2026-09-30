import clsx from 'clsx'
import { fmtNum, fmtPct, fmtUsd } from '../design/format'

export interface WindowRow {
  entryLabel: string
  exitLabel: string
  side: 'long' | 'short'
  years: number
  winRate: number
  avgPnl: number
  medianPnl: number
  tStat: number
  profitFactor: number
  avgMae: number
  active?: boolean
}

/**
 * Recurring seasonal windows found on PRIOR seasons (in-sample candidates, ranked
 * by win rate × |t|). The walk-forward OOS gate is what promotes a window, so
 * the table is labelled as history, never advice.
 */
export function WindowStatsTable({ windows, onSelect, selected }: { windows: WindowRow[]; onSelect?: (i: number) => void; selected?: number | null }) {
  if (windows.length === 0) return <p className="py-6 text-center text-xs text-muted">No window cleared the 70% win-rate / 7-season bar on prior seasons.</p>
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">Seasonal windows found on prior seasons</caption>
        <thead>
          <tr className="border-b border-border">
            {['Side', 'Window', 'Win', 'Yrs', 'Avg $', 'Median $', 'PF', 't', 'Avg MAE $'].map((h, i) => (
              <th key={h} scope="col" className={clsx('label px-2 py-1.5 font-medium', i < 2 ? 'text-left' : 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {windows.map((w, i) => (
            <tr
              key={i}
              onClick={onSelect ? () => onSelect(i) : undefined}
              className={clsx('border-b border-border/60 last:border-0', onSelect && 'cursor-pointer hover:bg-surface-2', selected === i && 'bg-surface-2')}
            >
              <td className="px-2 py-1.5">
                <span className={clsx('rounded px-1.5 py-px text-2xs font-medium uppercase ring-1 ring-inset', w.side === 'long' ? 'chip-strong' : 'chip-avoid')}>{w.side}</span>
                {w.active && <span className="chip-brand ml-1.5 rounded px-1.5 py-px text-2xs font-medium uppercase ring-1 ring-inset">now</span>}
              </td>
              <td className="num px-2 py-1.5 whitespace-nowrap">
                {w.entryLabel} → {w.exitLabel}
              </td>
              <td className="num px-2 py-1.5 text-right">{fmtPct(w.winRate, 0)}</td>
              <td className="num px-2 py-1.5 text-right">{w.years}</td>
              <td className="num px-2 py-1.5 text-right">{fmtUsd(w.avgPnl, 0)}</td>
              <td className="num px-2 py-1.5 text-right">{fmtUsd(w.medianPnl, 0)}</td>
              <td className="num px-2 py-1.5 text-right">{w.profitFactor >= 999 ? '∞' : fmtNum(w.profitFactor, 2)}</td>
              <td className="num px-2 py-1.5 text-right">{fmtNum(w.tStat, 2)}</td>
              <td className="num px-2 py-1.5 text-right text-neg-text">{fmtUsd(w.avgMae, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
