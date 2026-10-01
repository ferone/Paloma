import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { IntegrationStatus } from '@shared/api'
import { api } from '../../api/client'
import { requestAdminToken, setAdminToken } from '../../api/admin'
import { Button, Chip, Field, Input, PageHeader, Panel } from '../../ui'
import { ModelPicker } from '../macro/ai/ModelPicker'
import { ApiKeysPanel } from './ApiKeysPanel'
import { SchedulerPanel } from './SchedulerPanel'
import { useAdminStatus, useGeneralSettings, useLock, useSaveGeneral, useSecrets } from './api'

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="API keys, AI model, data budget and fund configuration. Changes need the admin PIN and apply immediately."
      />
      <ApiKeysPanel />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="AI model" eyebrow="OpenRouter">
          <ModelPicker />
        </Panel>
        <div className="grid gap-6">
          <BudgetPanel />
          <Panel title="Fund configuration" eyebrow="Portfolio">
            <p className="text-sm leading-relaxed text-muted">
              Inception date, base NAV per unit, physical-metal haircut, risk-free rate and the benchmark blend are edited with the ledger, where their effect on
              NAV is visible.
            </p>
            <Link to="/portfolio/ledger" className="mt-4 inline-block text-sm text-brand underline underline-offset-2">
              Open fund settings in the ledger
            </Link>
          </Panel>
        </div>
        <SchedulerPanel />
        <AdminPanel />
        <StoragePanel />
      </div>
    </>
  )
}

function BudgetPanel() {
  const general = useGeneralSettings()
  const save = useSaveGeneral()
  // null = untouched, so the field shows the saved value without syncing state.
  const [edit, setEdit] = useState<string | null>(null)
  const draft = edit ?? (general.data ? String(general.data.databentoBudget) : '')
  const setDraft = setEdit
  const n = Number(draft)
  const dirty = general.data !== undefined && draft !== '' && Number.isFinite(n) && n !== general.data.databentoBudget

  function submit(e: FormEvent) {
    e.preventDefault()
    if (dirty) save.mutate({ databentoBudget: n }, { onSuccess: () => setEdit(null) })
  }

  return (
    <Panel title="Data spend guard" eyebrow="Databento">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <Field label="Max cost per pull (USD)" hint="Any download estimated above this is refused unless explicitly overridden." className="w-56">
          <Input type="number" min={0} max={1000} step={0.5} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </Field>
        <Button type="submit" size="sm" variant="primary" disabled={!dirty || save.isPending}>
          Save
        </Button>
        {save.isSuccess && !dirty && <span className="text-xs text-pos-text">Saved</span>}
      </form>
    </Panel>
  )
}

function AdminPanel() {
  const admin = useAdminStatus()
  const lock = useLock()
  const [changing, setChanging] = useState(false)
  const s = admin.data
  return (
    <Panel title="Admin PIN" eyebrow="Access">
      <p className="mb-4 text-sm leading-relaxed text-muted">
        The dashboard only listens on this computer. The PIN protects keys and settings from anyone else using it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {s && <Chip tone={!s.pinSet ? 'watch' : s.unlocked ? 'strong' : 'neutral'}>{!s.pinSet ? 'No PIN yet' : s.unlocked ? 'Unlocked' : 'Locked'}</Chip>}
        {s && !s.pinSet && (
          <Button size="sm" variant="primary" onClick={() => void requestAdminToken(false).then(() => admin.refetch())}>
            Create PIN
          </Button>
        )}
        {s?.pinSet && !s.unlocked && (
          <Button size="sm" onClick={() => void requestAdminToken(true).then(() => admin.refetch())}>
            Unlock
          </Button>
        )}
        {s?.unlocked && (
          <Button size="sm" variant="ghost" onClick={() => lock.mutate()}>
            Lock now
          </Button>
        )}
        {s?.pinSet && (
          <Button size="sm" variant="ghost" onClick={() => setChanging((v) => !v)}>
            Change PIN
          </Button>
        )}
      </div>
      {changing && <ChangePin onDone={() => (setChanging(false), void admin.refetch())} />}
    </Panel>
  )
}

function ChangePin({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      const r = await api.post<{ token: string }>('/admin/pin', { pin: next, currentPin: current })
      setAdminToken(r.data.token)
      onDone()
    } catch (err) {
      const m = (err as { response?: { data?: { message?: string } } }).response?.data?.message
      setError(m ?? 'Could not change the PIN')
    }
  }
  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Current PIN">
        <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="New PIN">
        <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Button type="submit" size="sm" variant="primary" disabled={current.length < 4 || next.length < 4}>
        Change
      </Button>
      {error && <p className="text-xs text-neg-text sm:col-span-3">{error}</p>}
    </form>
  )
}

function StoragePanel() {
  const status = useQuery({ queryKey: ['status'], queryFn: async () => (await api.get<IntegrationStatus>('/status')).data })
  const secrets = useSecrets()
  return (
    <Panel title="Local storage" eyebrow="Backup">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Database</dt>
        <dd className="num break-all text-foreground">
          {status.data?.dbPath ?? '…'} {status.data && <Chip tone={status.data.dbReady ? 'strong' : 'avoid'}>{status.data.dbReady ? 'Ready' : 'Unavailable'}</Chip>}
        </dd>
        <dt className="text-muted">Encryption key</dt>
        <dd className="num break-all text-foreground">{secrets.data?.keyFile ?? '…'}</dd>
      </dl>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Back up both files together. The database holds the ledger, prices and the encrypted keys; the key file is what decrypts them. Without it, saved keys
        must be entered again (everything else is unaffected).
      </p>
    </Panel>
  )
}
