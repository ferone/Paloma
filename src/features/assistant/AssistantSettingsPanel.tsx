import { useState, type FormEvent } from 'react'
import type { AiModel } from '@shared/ai'
import type { AssistantSettings } from '@shared/assistant'
import { fmtNum, fmtUsd } from '../../design/format'
import { Button, ErrorNote, Field, Input, Panel, Select } from '../../ui'
import { errorMessage, useAiModels } from '../macro/api'
import { useAssistantSettings, useAssistantUsage, useSaveAssistantSettings } from './api'

// Settings → Assistant: main model, fallback model and monthly cap. Saving
// needs the admin PIN (the axios interceptor prompts for it).

const price = (m: AiModel | undefined) => (m && m.promptPrice != null && m.completionPrice != null ? `$${fmtNum(m.promptPrice, 2)} in / $${fmtNum(m.completionPrice, 2)} out per 1M tokens` : null)

function ModelSelect({ label, value, models, onChange, hint }: { label: string; value: string; models: AiModel[]; onChange(v: string): void; hint?: string }) {
  const options = models.some((m) => m.id === value) ? models : [{ id: value, name: value, contextLength: null, promptPrice: null, completionPrice: null }, ...models]
  return (
    <Field label={label} hint={price(models.find((m) => m.id === value)) ?? hint}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name === m.id ? m.id : `${m.name} — ${m.id}`}
          </option>
        ))}
      </Select>
    </Field>
  )
}

export function AssistantSettingsPanel() {
  const settings = useAssistantSettings()
  const usage = useAssistantUsage()
  const models = useAiModels()
  const save = useSaveAssistantSettings()
  const [draft, setDraft] = useState<Partial<AssistantSettings>>({})
  const [cap, setCap] = useState<string | null>(null)

  if (settings.isLoading) return <Panel title="Assistant" eyebrow="OpenRouter"><p className="text-xs text-muted">Loading…</p></Panel>
  if (settings.error || !settings.data)
    return (
      <Panel title="Assistant" eyebrow="OpenRouter">
        <ErrorNote error={settings.error} onRetry={() => settings.refetch()} />
      </Panel>
    )
  const s = { ...settings.data, ...draft }
  const capText = cap ?? String(settings.data.monthlyCapUsd)
  const capN = Number(capText)
  const capValid = capText.trim() !== '' && Number.isFinite(capN) && capN >= 0
  const dirty = s.model !== settings.data.model || s.fallbackModel !== settings.data.fallbackModel || (capValid && capN !== settings.data.monthlyCapUsd)
  const list = models.data?.models ?? []

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!dirty || !capValid) return
    save.mutate({ model: s.model, fallbackModel: s.fallbackModel, monthlyCapUsd: capN }, { onSuccess: () => (setDraft({}), setCap(null)) })
  }

  return (
    <Panel title="Assistant" eyebrow="OpenRouter">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs leading-relaxed text-muted">
          The assistant (Ctrl+J on any page) answers with the page’s data and the platform’s rules. From 80% of the monthly cap it switches to the fallback model; at 100% it stops
          until the next month (UTC). The cap counts assistant chats and AI analyst reports.
        </p>
        <ModelSelect label="Model" value={s.model} models={list} onChange={(v) => setDraft((d) => ({ ...d, model: v }))} hint="Default: the AI analyst model" />
        <ModelSelect label="Fallback model" value={s.fallbackModel} models={list} onChange={(v) => setDraft((d) => ({ ...d, fallbackModel: v }))} hint="A cheap, fast model" />
        <Field label="Monthly cap (USD)" hint={usage.data ? `Spent this month: ${fmtUsd(usage.data.monthSpendUsd, 2)}` : undefined}>
          <Input inputMode="decimal" value={capText} onChange={(e) => setCap(e.target.value)} aria-invalid={!capValid} className="num" />
        </Field>
        {models.data?.error && <p className="text-2xs text-muted">{models.data.error}</p>}
        {save.error && <p role="alert" className="text-2xs text-neg-text">{errorMessage(save.error)}</p>}
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" variant="primary" disabled={!dirty || !capValid || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          {save.isSuccess && !dirty && <span className="text-2xs text-muted">Saved.</span>}
        </div>
      </form>
    </Panel>
  )
}
