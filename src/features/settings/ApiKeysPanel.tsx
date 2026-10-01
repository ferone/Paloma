import { useState, type FormEvent } from 'react'
import { isAxiosError } from 'axios'
import type { SecretTestResult, SecretView } from '@shared/settings'
import { Button, Chip, ErrorNote, Input, Panel, PanelSkeleton, type ChipTone } from '../../ui'
import { fmtDateTime } from '../../design/format'
import { useRevertSecret, useSaveSecret, useSecrets, useTestSecret } from './api'

const SOURCE: Record<SecretView['source'], { label: string; tone: ChipTone }> = {
  settings: { label: 'Saved here', tone: 'strong' },
  env: { label: 'From .env', tone: 'moderate' },
  none: { label: 'Not set', tone: 'neutral' },
}

const errText = (e: unknown) => (isAxiosError(e) ? (e.response?.data?.message ?? e.message) : e instanceof Error ? e.message : String(e))

export function ApiKeysPanel() {
  const secrets = useSecrets()
  return (
    <Panel title="API keys" eyebrow="Integrations">
      <p className="mb-4 max-w-3xl text-sm leading-relaxed text-muted">
        Keys are encrypted on this machine and take effect immediately, with no restart. The browser only ever sees the last four characters. A key saved
        here overrides the same variable in <code className="num">.env</code>; revert to fall back to it.
      </p>
      {secrets.isLoading ? (
        <PanelSkeleton />
      ) : secrets.error ? (
        <ErrorNote error={secrets.error} onRetry={() => secrets.refetch()} />
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {secrets.data!.secrets.map((s) => (
            <KeyRow key={s.name} s={s} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function KeyRow({ s }: { s: SecretView }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [result, setResult] = useState<SecretTestResult | null>(null)
  const save = useSaveSecret()
  const revert = useRevertSecret()
  const test = useTestSecret()
  const src = s.unreadable ? { label: 'Re-enter key', tone: 'avoid' as ChipTone } : SOURCE[s.source]

  const runTest = async (candidate?: string) => {
    setResult(null)
    try {
      setResult(await test.mutateAsync({ name: s.name, value: candidate }))
    } catch (e) {
      setResult({ ok: false, message: errText(e) })
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      await save.mutateAsync({ name: s.name, value })
      setEditing(false)
      setValue('')
      await runTest()
    } catch {
      // shown below from save.error
    }
  }

  return (
    <li className="grid gap-3 py-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] md:items-start">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{s.label}</span>
          {!s.required && <span className="text-2xs text-faint">optional</span>}
        </div>
        <code className="num text-2xs text-muted">{s.name}</code>
      </div>

      <div className="min-w-0">
        <p className="text-sm text-muted">{s.purpose}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <Chip tone={src.tone}>{src.label}</Chip>
          {s.masked && <span className="num text-foreground">{s.masked}</span>}
          {s.updatedAt && <span className="text-faint">updated {fmtDateTime(s.updatedAt)}</span>}
          <a href={s.docsUrl} target="_blank" rel="noreferrer" className="text-brand underline underline-offset-2">
            Get a key
          </a>
        </div>
        {s.unreadable && (
          <p className="mt-2 text-xs text-neg-text">
            A key was saved, but this machine’s encryption key (secret.key) has changed, so it cannot be read. Enter it again.
          </p>
        )}

        {editing && (
          <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={`New ${s.label} key`}
              placeholder="Paste the new key"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="num max-w-md flex-1"
              autoFocus
            />
            <Button size="sm" variant="primary" type="submit" disabled={value.trim().length < 8 || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" onClick={() => runTest(value.trim())} disabled={value.trim().length < 8 || test.isPending}>
              Test first
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setValue(''), save.reset())}>
              Cancel
            </Button>
          </form>
        )}
        {save.error && <p className="mt-2 text-xs text-neg-text">{errText(save.error)}</p>}
        {test.isPending && <p className="mt-2 text-xs text-muted">Testing…</p>}
        {result && !test.isPending && (
          <p role="status" className={`mt-2 text-xs ${result.ok ? 'text-pos-text' : 'text-neg-text'}`}>
            {result.ok ? '✓ ' : '✕ '}
            {result.message}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 md:justify-end">
        {!editing && (
          <Button size="sm" onClick={() => (setEditing(true), setResult(null))}>
            {s.configured || s.unreadable ? 'Replace' : 'Add key'}
          </Button>
        )}
        {s.configured && !editing && (
          <Button size="sm" variant="ghost" onClick={() => runTest()} disabled={test.isPending}>
            Test
          </Button>
        )}
        {(s.source === 'settings' || s.unreadable) && !editing && (
          <Button size="sm" variant="ghost" onClick={() => revert.mutate(s.name)} disabled={revert.isPending} title="Remove the saved key and use .env instead">
            Revert to .env
          </Button>
        )}
      </div>
    </li>
  )
}
