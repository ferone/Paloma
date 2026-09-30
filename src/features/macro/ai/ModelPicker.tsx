import { useMemo, useState } from 'react'
import type { AiModel } from '@shared/ai'
import { Chip, ErrorNote, Field, Input, Select } from '../../../ui'
import { fmtNum } from '../../../design/format'
import { errorMessage, useAiModels, useAiStatus, useSaveAiSettings } from '../api'

const price = (m: AiModel | undefined) =>
  m && m.promptPrice != null && m.completionPrice != null ? `$${fmtNum(m.promptPrice, 2)} in / $${fmtNum(m.completionPrice, 2)} out per 1M tokens` : null

/**
 * OpenRouter model picker with the `:online` web-search toggle. Saves to the
 * server settings (ai.model, ai.online) on change. Mounted on /macro/analyst
 * and on the Settings page.
 */
export function ModelPicker({ compact = false }: { compact?: boolean }) {
  const status = useAiStatus()
  const models = useAiModels()
  const save = useSaveAiSettings()
  const [filter, setFilter] = useState('')

  const list = useMemo(() => {
    const all = models.data?.models ?? []
    const f = filter.trim().toLowerCase()
    return f ? all.filter((m) => m.id.toLowerCase().includes(f) || m.name.toLowerCase().includes(f)) : all
  }, [models.data, filter])

  if (status.isLoading) return <p className="text-xs text-muted">Loading AI settings…</p>
  if (status.error) return <ErrorNote error={status.error} onRetry={() => status.refetch()} />
  const s = status.data!
  const current = models.data?.models.find((m) => m.id === s.model)
  // Keep the saved model selectable even if the catalogue filter hides it.
  const options = current || !s.model ? list : [{ id: s.model, name: s.model, contextLength: null, promptPrice: null, completionPrice: null }, ...list]

  return (
    <div className="space-y-3">
      <div className={compact ? 'space-y-3' : 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'}>
        <Field label="Filter models">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. claude, gpt, gemini" aria-label="Filter models" />
        </Field>
        <Field
          label="Model"
          hint={models.data?.error ? models.data.error : (price(current) ?? `Default: ${s.defaultModel}`)}
        >
          <Select value={s.model} disabled={save.isPending || models.isLoading} onChange={(e) => save.mutate({ model: e.target.value })}>
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name === m.id ? m.id : `${m.name} — ${m.id}`}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 accent-[var(--brand)]"
          checked={s.online}
          disabled={save.isPending}
          onChange={(e) => save.mutate({ online: e.target.checked })}
        />
        <span>
          <span className="font-medium text-foreground">Web sourcing (:online)</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted">
            Runs a live web search (3 results) with each request and lets the model cite those pages. Only URLs the search actually returned, or the
            FRED/CFTC pages behind our own data, are kept as sources; every other claim is flagged “unsourced”. Off: the model can cite only our
            data sources. Adds roughly $0.01–0.02 per report.
          </span>
        </span>
      </label>
      <p className="flex flex-wrap items-center gap-2 text-2xs text-muted">
        Sent to OpenRouter as <code className="num text-foreground">{s.effectiveModel}</code>
        {!s.configured && <Chip tone="watch">Key not set</Chip>}
        {save.error && <span className="text-neg-text">{errorMessage(save.error)}</span>}
      </p>
    </div>
  )
}
