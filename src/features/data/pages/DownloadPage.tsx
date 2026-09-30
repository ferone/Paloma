import { useId, useMemo, useState } from 'react'
import { RiDownload2Line } from 'react-icons/ri'
import { COT_MARKETS, DATABENTO_ROOTS, GENERIC_EXPORT_TABLES, MARKET_EXPORT_DATASETS, type ExportDataset, type ExportFormat } from '@shared/marketdata'
import { fmtAge, fmtNum } from '../../../design/format'
import { Chip, ErrorNote, Field, Input, Panel, PanelSkeleton, Segmented, Select } from '../../../ui'
import { useArtifacts, useFreshness, useSymbols } from '../api'
import { ARTIFACT_LABEL, datasetLabel } from '../labels'

const SYMBOL_HINT: Partial<Record<ExportDataset, string>> = {
  prices_daily: 'Symbol, e.g. GC=F, GLD, GC.c.0',
  contracts: `Root (${DATABENTO_ROOTS.join(', ')}) or contract, e.g. GCZ26`,
  contract_bars: 'Root (all months) or contract, e.g. GCZ26',
  macro_series: 'Series id, e.g. DFII10',
  cot_reports: `Market: ${COT_MARKETS.join(', ')}`,
}
const HAS_SOURCE: ExportDataset[] = ['prices_daily', 'contract_bars', 'macro_series']
const HAS_DATES = (d: ExportDataset) => d !== 'contracts'

const linkButton =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-foreground px-3.5 text-sm font-medium text-background transition-colors hover:bg-foreground/85'

function exportUrl(p: { dataset: string; symbol?: string; source?: string; from?: string; to?: string; format: ExportFormat }): string {
  const q = new URLSearchParams({ dataset: p.dataset })
  if (p.symbol) q.set('symbol', p.symbol)
  if (p.source) q.set('source', p.source)
  if (p.from) q.set('from', p.from)
  if (p.to) q.set('to', p.to)
  q.set('format', p.format)
  return `/api/marketdata/export?${q.toString()}`
}

export default function DownloadPage() {
  const fresh = useFreshness()
  const symbols = useSymbols()
  const artifacts = useArtifacts()
  const listId = useId()

  const [dataset, setDataset] = useState<ExportDataset>('prices_daily')
  const [symbol, setSymbol] = useState('')
  const [source, setSource] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [format, setFormat] = useState<ExportFormat>('csv')

  const info = useMemo(() => {
    const rows = fresh.data?.rows.filter((r) => r.dataset === dataset) ?? []
    return { exists: rows.some((r) => r.exists), rows: rows.reduce((s, r) => s + r.rows, 0), sources: rows.map((r) => r.source).filter((s) => s !== '—') }
  }, [fresh.data, dataset])

  const suggestions = useMemo(() => {
    if (dataset === 'prices_daily') return [...new Set(symbols.data?.map((s) => s.symbol) ?? [])]
    if (dataset === 'contracts' || dataset === 'contract_bars') return [...DATABENTO_ROOTS]
    if (dataset === 'cot_reports') return [...COT_MARKETS]
    return []
  }, [dataset, symbols.data])

  const badRange = !!from && !!to && from > to
  const href = exportUrl({ dataset, symbol: symbol.trim() || undefined, source: HAS_SOURCE.includes(dataset) ? source || undefined : undefined, from: HAS_DATES(dataset) ? from || undefined : undefined, to: HAS_DATES(dataset) ? to || undefined : undefined, format })
  const disabled = !info.exists || badRange

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Panel title="Export a dataset" eyebrow="CSV · JSON" density="dense" provenance={{ source: 'Streamed from the local SQLite store; CSV is RFC 4180 (quoted fields, CRLF rows)' }}>
        {fresh.isLoading ? (
          <PanelSkeleton />
        ) : fresh.error ? (
          <ErrorNote error={fresh.error} onRetry={() => fresh.refetch()} />
        ) : (
          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Dataset" hint={info.exists ? `${fmtNum(info.rows, 0)} rows stored` : 'Not created yet by its domain'}>
                <Select
                  value={dataset}
                  onChange={(e) => {
                    setDataset(e.target.value as ExportDataset)
                    setSymbol('')
                    setSource('')
                  }}
                >
                  <optgroup label="Market data">
                    {MARKET_EXPORT_DATASETS.map((d) => (
                      <option key={d} value={d}>
                        {datasetLabel(d)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Fund & research tables">
                    {GENERIC_EXPORT_TABLES.map((d) => (
                      <option key={d} value={d}>
                        {datasetLabel(d)}
                      </option>
                    ))}
                  </optgroup>
                </Select>
              </Field>
              <Field label="Symbol / filter" hint={SYMBOL_HINT[dataset] ?? 'Not applicable: the whole table is exported'}>
                <Input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  list={listId}
                  placeholder="All"
                  disabled={!(dataset in SYMBOL_HINT)}
                  className="num"
                  autoComplete="off"
                  spellCheck={false}
                />
                <datalist id={listId}>
                  {suggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
              {HAS_SOURCE.includes(dataset) && (
                <Field label="Source">
                  <Select value={source} onChange={(e) => setSource(e.target.value)}>
                    <option value="">All sources</option>
                    {info.sources.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <div className="flex flex-col justify-end">
                <span className="label mb-1 block">Format</span>
                <Segmented<ExportFormat> ariaLabel="Export format" size="md" value={format} onChange={setFormat} options={[{ value: 'csv', label: 'CSV' }, { value: 'json', label: 'JSON' }]} />
              </div>
              {HAS_DATES(dataset) && (
                <>
                  <Field label="From" hint="Inclusive; blank = earliest">
                    <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="num" />
                  </Field>
                  <Field label="To" error={badRange ? '“To” is before “From”' : undefined} hint="Inclusive; blank = latest">
                    <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="num" />
                  </Field>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
              {disabled ? (
                <span aria-disabled className={`${linkButton} cursor-not-allowed opacity-50`}>
                  <RiDownload2Line aria-hidden /> Download
                </span>
              ) : (
                <a className={linkButton} href={href} download>
                  <RiDownload2Line aria-hidden /> Download
                </a>
              )}
              <code className="num min-w-0 flex-1 break-all text-2xs text-muted" title="Same request for scripts (curl, pandas.read_csv)">
                GET {href}
              </code>
            </div>
          </form>
        )}
      </Panel>

      <Panel
        title="Analysis artifacts"
        eyebrow="JSON"
        density="dense"
        actions={
          <a className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 text-xs font-medium text-foreground hover:bg-surface-2" href="/api/marketdata/export/research-pack" download>
            <RiDownload2Line aria-hidden /> Research pack
          </a>
        }
        provenance={{ source: 'Published by each domain on recompute', note: 'Research pack = every artifact below + dataset freshness, one file' }}
      >
        {artifacts.isLoading ? (
          <PanelSkeleton rows={4} />
        ) : artifacts.error ? (
          <ErrorNote error={artifacts.error} onRetry={() => artifacts.refetch()} />
        ) : (
          <ul className="divide-y divide-border/60">
            {artifacts.data!.map((a) => (
              <li key={a.name} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm text-foreground">{ARTIFACT_LABEL[a.name] ?? a.name}</div>
                  <div className="num text-2xs text-faint">
                    {a.name}
                    {a.generatedAt && ` · ${fmtAge(`${a.generatedAt.replace(' ', 'T')}Z`)}`}
                  </div>
                </div>
                {a.available ? (
                  <a className="text-xs text-brand underline underline-offset-2" href={`/api/marketdata/export/artifact/${encodeURIComponent(a.name)}`} download>
                    Download
                  </a>
                ) : (
                  <Chip tone="neutral" title="Its domain has not published it yet">
                    Not published
                  </Chip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
