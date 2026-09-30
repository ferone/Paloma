import type { ReactNode } from 'react'
import { RiDeleteBinLine, RiExternalLinkLine, RiRefreshLine } from 'react-icons/ri'
import type { AiReport, Claim, Driver, Sentiment, SourceRef } from '@shared/ai'
import { UNIVERSE } from '@shared/universe'
import { Button, Chip, type ChipTone } from '../../../ui'
import { fmtDate, fmtDateTime, fmtNum } from '../../../design/format'
import { KIND_LABEL, fmtCost } from './labels'

const SENTIMENT_TONE: Record<Sentiment, ChipTone> = { bullish: 'strong', bearish: 'avoid', neutral: 'neutral' }

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function SourceLinks({ sources }: { sources: SourceRef[] }) {
  return (
    <span className="ml-1 inline-flex flex-wrap gap-x-2 align-baseline">
      {sources.map((s) => (
        <a
          key={s.url}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          title={s.title ?? s.url}
          className="inline-flex items-center gap-0.5 text-2xs text-brand underline-offset-2 hover:underline"
        >
          {s.publisher || host(s.url)}
          <RiExternalLinkLine size={10} aria-hidden />
        </a>
      ))}
    </span>
  )
}

function Unsourced() {
  return (
    <Chip tone="watch" title="No verifiable source survived validation for this claim" className="ml-1.5 align-middle">
      Unsourced
    </Chip>
  )
}

function ClaimList({ items }: { items: Claim[] }) {
  if (!items.length) return <p className="text-sm text-muted">None given.</p>
  return (
    <ul className="space-y-2">
      {items.map((c, i) => (
        <li key={i} className="border-l-2 border-border pl-3 text-[15px] leading-relaxed text-foreground/90">
          {c.text}
          {c.sourced ? <SourceLinks sources={c.sources} /> : <Unsourced />}
        </li>
      ))}
    </ul>
  )
}

function DriverList({ drivers }: { drivers: Driver[] }) {
  return (
    <ol className="space-y-4">
      {drivers.map((d, i) => (
        <li key={i}>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-medium text-foreground">{d.title}</h4>
            <Chip tone={SENTIMENT_TONE[d.sentiment]}>{d.sentiment}</Chip>
            {!d.sourced && <Unsourced />}
          </div>
          <p className="mt-1 text-[15px] leading-relaxed text-foreground/90">
            {d.detail}
            {d.sourced && <SourceLinks sources={d.sources} />}
          </p>
        </li>
      ))}
    </ol>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h3 className="label mb-2.5">{title}</h3>
      {children}
    </section>
  )
}

function Body({ r }: { r: AiReport }) {
  const b = r.body!
  switch (b.kind) {
    case 'macro_brief':
      return (
        <>
          <div className="flex items-center gap-2">
            <span className="label">Outlook</span>
            <Chip tone={SENTIMENT_TONE[b.outlook]}>{b.outlook}</Chip>
          </div>
          <p className="mt-3 text-[17px] leading-relaxed text-foreground">{b.summary}</p>
          <Section title="Drivers">
            <DriverList drivers={b.drivers} />
          </Section>
          <Section title="Risks">
            <ClaimList items={b.risks} />
          </Section>
          <Section title="What would change my mind">
            <ClaimList items={b.whatWouldChangeMyMind} />
          </Section>
        </>
      )
    case 'trade_brief':
      return (
        <>
          <p className="text-[17px] leading-relaxed text-foreground">{b.thesis}</p>
          {b.structure && (
            <Section title="Structure">
              <p className="text-[15px] leading-relaxed text-foreground/90">{b.structure}</p>
              {b.legs.length > 0 && (
                <table className="mt-3 w-full text-sm">
                  <caption className="sr-only">Trade legs</caption>
                  <thead>
                    <tr className="border-b border-border">
                      <th className="label py-1 text-left font-medium">Leg</th>
                      <th className="label py-1 text-left font-medium">Side</th>
                      <th className="label py-1 text-right font-medium">Ratio</th>
                      <th className="label py-1 pl-4 text-left font-medium">Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.legs.map((l, i) => (
                      <tr key={i} className="border-b border-border/60 last:border-0">
                        <td className="num py-1.5">{l.instrument}</td>
                        <td className="py-1.5">
                          <Chip tone={l.side === 'long' ? 'strong' : 'avoid'}>{l.side}</Chip>
                        </td>
                        <td className="num py-1.5 text-right">{l.ratio ?? '—'}</td>
                        <td className="py-1.5 pl-4 text-muted">{l.role ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          )}
          <Section title="Entry plan">
            <p className="text-[15px] leading-relaxed text-foreground/90">{b.entryPlan || '—'}</p>
          </Section>
          <Section title="Catalysts">
            <ClaimList items={b.catalysts} />
          </Section>
          <Section title="Risks">
            <ClaimList items={b.risks} />
          </Section>
          <Section title="Invalidation">
            <p className="text-[15px] leading-relaxed text-foreground/90">{b.invalidation || '—'}</p>
          </Section>
        </>
      )
    case 'portfolio_commentary':
      return (
        <>
          <p className="text-[17px] leading-relaxed text-foreground">{b.paragraph}</p>
          <Section title="Highlights">
            <ClaimList items={b.bullets} />
          </Section>
        </>
      )
    case 'ask':
      return (
        <>
          <p className="display mb-3 text-lg italic text-muted">“{b.question}”</p>
          {b.answer.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="mt-3 text-[17px] leading-relaxed text-foreground first:mt-0">
              {para}
            </p>
          ))}
          <Section title="Supporting points">
            <ClaimList items={b.points} />
          </Section>
        </>
      )
  }
}

interface ReaderProps {
  report: AiReport
  onRegenerate?: () => void
  onDelete?: () => void
  busy?: boolean
}

/** Editorial reading layout for one AI report: serif headline, ~70ch measure, sources as real links. */
export function ReportReader({ report: r, onRegenerate, onDelete, busy }: ReaderProps) {
  return (
    <article className="mx-auto max-w-[70ch]">
      <header className="border-b border-border pb-4">
        <div className="label mb-2">
          {KIND_LABEL[r.kind]} · {UNIVERSE[r.metal]?.label ?? r.metal} · {fmtDateTime(r.createdAt)}
        </div>
        <h2 className="display text-[clamp(1.5rem,2.4vw,2rem)] leading-tight text-foreground">
          {r.body?.kind === 'portfolio_commentary' && r.body.headline ? r.body.headline : r.title}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {r.status === 'running' && <Chip tone="brand">Generating…</Chip>}
          {r.status === 'failed' && <Chip tone="avoid">Failed</Chip>}
          {r.online ? <Chip tone="neutral">Web-sourced</Chip> : <Chip tone="neutral">No web search</Chip>}
          {r.status === 'succeeded' &&
            (r.unsourcedCount > 0 ? (
              <Chip tone="watch" title="Claims without a verified source are marked in the text">
                {r.unsourcedCount} unsourced
              </Chip>
            ) : (
              <Chip tone="strong">All claims sourced</Chip>
            ))}
          {r.droppedSources > 0 && (
            <Chip tone="neutral" title="URLs the model cited that were not returned by the web search nor part of our data sources">
              {r.droppedSources} unverifiable link{r.droppedSources === 1 ? '' : 's'} removed
            </Chip>
          )}
        </div>
        <p className="mt-2 text-2xs text-muted">
          <code className="num">{r.model}</code> · {r.tokens != null ? `${fmtNum(r.tokens, 0)} tokens` : 'tokens n/a'} · cost{' '}
          <span className="num">{fmtCost(r.costUsd)}</span>
          {r.asOf && <> · live data through {fmtDate(r.asOf)}</>}
        </p>
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted">
          {r.context.map((c) => (
            <span key={c.name} className={c.present ? '' : 'text-faint line-through decoration-faint'} title={c.present ? `Included, data as of ${c.asOf ?? 'n/a'}` : 'Not available when generated'}>
              {c.name}
              {c.present && c.asOf ? ` (${fmtDate(c.asOf)})` : c.present ? '' : ' (absent)'}
            </span>
          ))}
        </p>
      </header>

      <div className="py-5">
        {r.status === 'running' && <p className="text-sm text-muted">The analyst is working. This usually takes 20–60 seconds with web search.</p>}
        {r.status === 'failed' && (
          <p role="alert" className="rounded-md border border-neg/30 bg-neg/5 px-3 py-2 text-sm text-neg-text">
            {r.error ?? 'Generation failed.'}
          </p>
        )}
        {r.status === 'succeeded' && r.body && <Body r={r} />}
      </div>

      {r.sources.length > 0 && (
        <footer className="border-t border-border pt-4">
          <h3 className="label mb-2">Sources ({r.sources.length})</h3>
          <ol className="list-decimal space-y-1 pl-5 text-xs">
            {r.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-brand underline-offset-2 hover:underline">
                  {s.title || s.url}
                </a>
                <span className="text-muted"> · {s.publisher || host(s.url)}</span>
                {s.date && <span className="text-muted"> · {fmtDate(s.date)}</span>}
              </li>
            ))}
          </ol>
        </footer>
      )}
      {r.webResults.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted hover:text-foreground">Web results consulted ({r.webResults.length})</summary>
          <ul className="mt-1.5 space-y-1 pl-4">
            {r.webResults.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-brand underline-offset-2 hover:underline">
                  {s.title || s.url}
                </a>
                <span className="text-muted"> · {host(s.url)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-5 text-2xs leading-relaxed text-muted">
        AI-written, advisory only. It is never fed into scores or trades. Verify material claims against the linked sources.
      </p>
      {(onRegenerate || onDelete) && (
        <div className="mt-4 flex gap-2">
          {onRegenerate && (
            <Button size="sm" onClick={onRegenerate} disabled={busy || r.status === 'running'}>
              <RiRefreshLine size={13} aria-hidden /> Regenerate
            </Button>
          )}
          {onDelete && (
            <Button size="sm" variant="danger" onClick={onDelete} disabled={busy}>
              <RiDeleteBinLine size={13} aria-hidden /> Delete
            </Button>
          )}
        </div>
      )}
    </article>
  )
}
