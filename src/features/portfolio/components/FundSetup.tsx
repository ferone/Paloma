import { useState, type FormEvent } from 'react'
import { CUSTODY_LABEL, CUSTODY_TYPES, DEFAULT_PORTFOLIO_SETTINGS, accountInputSchema, type Account, type CustodyType, type PortfolioSettings } from '@shared/portfolio'
import { fmtDate, fmtNum, fmtPct } from '../../../design/format'
import { Button, Chip, ErrorNote, Field, Input, Panel, PanelSkeleton, Select } from '../../../ui'
import { apiErrorMessage, useBatches, useDeleteAccount, usePortfolioSettings, useRollbackBatch, useSaveAccount, useSaveSettings } from '../api'

/** "GLD:70, SLV:30": the default blend in the text syntax the settings field accepts. */
const BLEND_EXAMPLE = DEFAULT_PORTFOLIO_SETTINGS.blend.map((b) => `${b.symbol}:${Math.round(b.weight * 100)}`).join(', ')

export function AccountsPanel({ accounts }: { accounts: Account[] }) {
  const save = useSaveAccount()
  const del = useDeleteAccount()
  const [name, setName] = useState('')
  const [custody, setCustody] = useState<CustodyType>('broker')
  const [institution, setInstitution] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const body = { name, custody, institution: institution || null }
    const p = accountInputSchema.safeParse(body)
    if (!p.success) return setErr(p.error.issues[0].message)
    setErr(null)
    save.mutate(
      { body },
      {
        onSuccess: () => {
          setName('')
          setInstitution('')
        },
      },
    )
  }

  return (
    <Panel title="Accounts" eyebrow="Custody" provenance={{ source: 'Fund ledger', note: 'An account can be deleted only when nothing references it' }}>
      {accounts.length === 0 && <p className="mb-3 text-sm text-muted">Create the broker, vault or bank account where the first transaction settles.</p>}
      <ul className="divide-y divide-border/60">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              <span className="text-foreground">{a.name}</span>
              {a.institution && <span className="ml-2 text-xs text-muted">{a.institution}</span>}
            </span>
            <span className="flex items-center gap-2">
              <Chip>{CUSTODY_LABEL[a.custody]}</Chip>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete account ${a.name}`}
                onClick={() => {
                  if (confirm(`Delete account "${a.name}"?`)) del.mutate(a.id)
                }}
              >
                Delete
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {del.error && <div className="mt-2"><ErrorNote error={new Error(apiErrorMessage(del.error))} /></div>}
      <form onSubmit={submit} className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
        <Field label="Name" className="col-span-2" error={err}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Prime Broker" />
        </Field>
        <Field label="Custody">
          <Select value={custody} onChange={(e) => setCustody(e.target.value as CustodyType)}>
            {CUSTODY_TYPES.map((c) => (
              <option key={c} value={c}>
                {CUSTODY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Institution">
          <Input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Optional" />
        </Field>
        {save.error && <div className="col-span-2"><ErrorNote error={new Error(apiErrorMessage(save.error))} /></div>}
        <div className="col-span-2 flex justify-end">
          <Button type="submit" size="sm" disabled={save.isPending}>
            Add account
          </Button>
        </div>
      </form>
    </Panel>
  )
}

export function SettingsPanel() {
  const q = usePortfolioSettings()
  if (q.isLoading) return <Panel title="Fund settings"><PanelSkeleton /></Panel>
  if (q.error) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />
  // Keyed so the form re-initializes when saved settings change.
  return <SettingsForm key={JSON.stringify(q.data!.settings)} settings={q.data!.settings} effective={q.data!.effectiveInceptionDate} />
}

function SettingsForm({ settings, effective }: { settings: PortfolioSettings; effective: string | null }) {
  const save = useSaveSettings()
  const [inception, setInception] = useState(settings.inceptionDate ?? '')
  const [base, setBase] = useState(String(settings.baseNavPerUnit))
  const [haircut, setHaircut] = useState(String(settings.physicalHaircut * 100))
  const [rfMode, setRfMode] = useState<'fixed' | 'irx'>(settings.riskFree === 'irx' ? 'irx' : 'fixed')
  const [rf, setRf] = useState(settings.riskFree === 'irx' ? '0' : String(settings.riskFree * 100))
  const [blend, setBlend] = useState(settings.blend.map((b) => `${b.symbol}:${fmtNum(b.weight * 100, 0)}`).join(', '))
  const [err, setErr] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const legs = blend
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [symbol, w] = s.split(':').map((x) => x.trim())
        return { symbol: symbol.toUpperCase(), weight: Number(w) / 100 }
      })
    if (legs.some((l) => !l.symbol || !Number.isFinite(l.weight))) return setErr(`Blend must look like "${BLEND_EXAMPLE}"`)
    setErr(null)
    save.mutate({
      inceptionDate: inception || null,
      baseNavPerUnit: Number(base),
      physicalHaircut: Number(haircut) / 100,
      riskFree: rfMode === 'irx' ? 'irx' : Number(rf) / 100,
      blend: legs,
    })
  }

  return (
    <Panel title="Fund settings" eyebrow="Valuation & performance" provenance={{ source: 'Portfolio settings', note: `Effective inception ${fmtDate(effective)}` }}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        <Field label="Inception date" hint="Blank = first transaction">
          <Input type="date" value={inception} onChange={(e) => setInception(e.target.value)} />
        </Field>
        <Field label="Base NAV / unit" hint="Set by the first subscription">
          <Input type="number" step="any" min={0} value={base} onChange={(e) => setBase(e.target.value)} />
        </Field>
        <Field label="Physical haircut (%)" hint={`Currently ${fmtPct(settings.physicalHaircut)}`}>
          <Input type="number" step="0.01" min={0} max={50} value={haircut} onChange={(e) => setHaircut(e.target.value)} />
        </Field>
        <Field label="Risk-free rate">
          <div className="flex gap-2">
            <Select value={rfMode} onChange={(e) => setRfMode(e.target.value as 'fixed' | 'irx')} className="w-28">
              <option value="fixed">Fixed %</option>
              <option value="irx">^IRX</option>
            </Select>
            {rfMode === 'fixed' && <Input type="number" step="0.01" value={rf} onChange={(e) => setRf(e.target.value)} aria-label="Risk-free rate percent" />}
          </div>
        </Field>
        <Field label="Benchmark blend (symbol:weight %)" className="col-span-2" error={err}>
          <Input value={blend} onChange={(e) => setBlend(e.target.value)} className="num" />
        </Field>
        {save.error && <div className="col-span-2"><ErrorNote error={new Error(apiErrorMessage(save.error))} /></div>}
        <div className="col-span-2 flex items-center justify-end gap-3">
          {save.isSuccess && <span className="text-xs text-muted">Saved · NAV recomputed</span>}
          <Button type="submit" size="sm" disabled={save.isPending}>
            Save settings
          </Button>
        </div>
      </form>
    </Panel>
  )
}

export function BatchesPanel() {
  const q = useBatches()
  const rollback = useRollbackBatch()
  const batches = q.data ?? []
  return (
    <Panel title="Import batches" eyebrow="CSV" provenance={{ source: 'Import log', note: 'Rollback deletes the batch’s transactions; the audit log keeps them' }}>
      {batches.length === 0 ? (
        <p className="text-sm text-muted">No imports yet.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {batches.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-foreground">{b.filename ?? 'Pasted CSV'}</span>
                <span className="num text-2xs text-muted">
                  {b.id} · {b.rowCount} rows · {fmtDate(b.createdAt.slice(0, 10))}
                </span>
              </span>
              {b.status === 'rolled_back' ? (
                <Chip>Rolled back</Chip>
              ) : (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={rollback.isPending}
                  onClick={() => {
                    if (confirm(`Roll back batch ${b.id}? This deletes its ${b.rowCount} transactions.`)) rollback.mutate(b.id)
                  }}
                >
                  Roll back
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {rollback.error && <ErrorNote error={new Error(apiErrorMessage(rollback.error))} />}
    </Panel>
  )
}
