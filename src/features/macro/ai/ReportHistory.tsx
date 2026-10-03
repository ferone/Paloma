import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { AiReportSummary, ReportKind } from '@shared/ai'
import { Chip, Select } from '../../../ui'
import { fmtDate } from '../../../design/format'
import { KIND_LABEL, fmtCost, shortModel } from './labels'

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/**
 * Every report ever generated for the asset in focus, newest first, grouped by
 * day. Nothing is overwritten: a regenerate or a run with another model is a new
 * entry, so outputs can be compared across models and dates.
 */
export function ReportHistory({ reports, activeId, latestId, onSelect }: { reports: AiReportSummary[]; activeId: number | null; latestId: number | null; onSelect: (id: number) => void }) {
  const [kind, setKind] = useState<ReportKind | 'all'>('all')
  const [model, setModel] = useState<string>('all')
  const kinds = useMemo(() => [...new Set(reports.map((r) => r.kind))], [reports])
  const models = useMemo(() => [...new Set(reports.map((r) => shortModel(r.model)))].sort(), [reports])
  const shown = reports.filter((r) => (kind === 'all' || r.kind === kind) && (model === 'all' || shortModel(r.model) === model))
  const byDay = useMemo(() => {
    const groups: { day: string; items: AiReportSummary[] }[] = []
    for (const r of shown) {
      const day = r.createdAt.slice(0, 10)
      const g = groups.at(-1)
      if (g && g.day === day) g.items.push(r)
      else groups.push({ day, items: [r] })
    }
    return groups
  }, [shown])

  return (
    <div>
      {(kinds.length > 1 || models.length > 1) && (
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Select aria-label="Filter by report type" value={kind} onChange={(e) => setKind(e.target.value as ReportKind | 'all')} className="text-xs">
            <option value="all">All types</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by model" value={model} onChange={(e) => setModel(e.target.value)} className="text-xs">
            <option value="all">All models</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>
      )}
      <p className="mb-2 text-2xs text-muted">
        {shown.length === reports.length ? `${reports.length} saved` : `${shown.length} of ${reports.length} saved`} · every run is kept
      </p>
      {shown.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted">No report matches these filters.</p>
      ) : (
        <div className="-mx-1 max-h-[560px] overflow-y-auto">
          {byDay.map((g) => (
            <section key={g.day} aria-label={fmtDate(g.day)}>
              <h3 className="label sticky top-0 z-[1] bg-surface px-2 pb-1 pt-2">{fmtDate(g.day)}</h3>
              <ul className="space-y-px">
                {g.items.map((r) => (
                  <HistoryItem key={r.id} r={r} active={r.id === activeId} latest={r.id === latestId} onSelect={() => onSelect(r.id)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function HistoryItem({ r, active, latest, onSelect }: { r: AiReportSummary; active: boolean; latest: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={clsx('w-full rounded-md px-2 py-1.5 text-left transition-colors pointer-coarse:py-2.5', active ? 'bg-surface-2' : 'hover:bg-surface-2/60')}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] text-foreground">{r.title}</span>
          <span className="flex shrink-0 items-center gap-1">
            {latest && <Chip tone="brand">Latest</Chip>}
            {r.status === 'running' ? (
              <Chip tone="brand">Running</Chip>
            ) : r.status === 'failed' ? (
              <Chip tone="avoid">Failed</Chip>
            ) : r.unsourcedCount > 0 ? (
              <Chip tone="watch">{r.unsourcedCount} unsourced</Chip>
            ) : null}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-2xs text-muted">
          <span className="num">{time(r.createdAt)}</span>
          <span>·</span>
          <span>{KIND_LABEL[r.kind]}</span>
          <span>·</span>
          <span className="num" title={r.model}>
            {shortModel(r.model)}
            {r.online ? ' + web' : ''}
          </span>
          <span>·</span>
          <span className="num">{fmtCost(r.costUsd)}</span>
        </div>
      </button>
    </li>
  )
}
