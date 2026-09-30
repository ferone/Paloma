import clsx from 'clsx'
import { useState } from 'react'
import { IMPORT_FIELDS, TXN_TYPE_LABEL, type Account, type ImportCommitResponse, type ImportField, type ImportMapping, type ImportPreviewResponse } from '@shared/portfolio'
import { ASSETS, UNIVERSE } from '@shared/universe'
import { fmtDate, fmtNum, fmtUsd } from '../../../design/format'
import { Button, Chip, ErrorNote, Field, Select, Textarea } from '../../../ui'
import { apiErrorMessage, useImportCommit, useImportPreview, useRollbackBatch } from '../api'

const FIELD_LABEL: Record<ImportField, string> = {
  tradeDate: 'Trade date *',
  settleDate: 'Settle date',
  type: 'Type *',
  instrument: 'Instrument / symbol',
  account: 'Account',
  counterAccount: 'Destination account',
  quantity: 'Quantity',
  price: 'Price',
  fees: 'Fees',
  amount: 'Amount',
  notes: 'Notes',
}

type Step = 'upload' | 'map' | 'done'
const STEPS: { id: Step; label: string }[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'map', label: 'Map & preview' },
  { id: 'done', label: 'Committed' },
]

export function ImportWizard({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const [step, setStep] = useState<Step>('upload')
  const [csv, setCsv] = useState('')
  const [filename, setFilename] = useState<string | null>(null)
  const [mapping, setMapping] = useState<ImportMapping>({})
  const [defaultAccountId, setDefaultAccountId] = useState<number | null>(accounts[0]?.id ?? null)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [result, setResult] = useState<ImportCommitResponse | null>(null)
  const previewMut = useImportPreview()
  const commit = useImportCommit()
  const rollback = useRollbackBatch()

  const runPreview = (m?: ImportMapping) =>
    previewMut.mutate(
      { csv, mapping: m as Record<string, string> | undefined, defaultAccountId, filename },
      {
        onSuccess: (p) => {
          setPreview(p)
          setMapping(p.mapping)
          setStep('map')
        },
      },
    )

  async function onFile(file: File | undefined) {
    if (!file) return
    setFilename(file.name)
    setCsv(await file.text())
  }

  const rows = preview?.rows.filter((r) => !onlyProblems || r.errors.length || r.warnings.length) ?? []
  const toImport = preview ? preview.rows.filter((r) => r.parsed && !(skipDuplicates && (r.duplicateOfTxnId || r.duplicateInFile))).length : 0

  return (
    <div className="space-y-5">
      <ol className="flex gap-6 text-xs" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li key={s.id} aria-current={s.id === step ? 'step' : undefined} className={clsx('flex items-center gap-2', s.id === step ? 'text-foreground' : 'text-muted')}>
            <span className={clsx('num inline-flex h-5 w-5 items-center justify-center rounded-full border text-2xs', s.id === step ? 'border-brand text-brand' : 'border-border')}>{i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>

      {step === 'upload' && (
        <div className="space-y-4">
          <Field label="CSV file" hint="Broker or custodian exports work; columns are auto-mapped and you can adjust the mapping next.">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onFile(e.target.files?.[0])}
              className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-foreground"
            />
          </Field>
          <Field label="…or paste CSV text">
            <Textarea
              rows={8}
              className="num text-xs"
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value)
                setFilename(null)
              }}
              placeholder={`trade_date,type,instrument,account,quantity,price,fees,notes\n2026-01-05,buy,${UNIVERSE[ASSETS[0]].benchmarkEtf},Prime Broker,100,245.10,1.00,`}
            />
          </Field>
          <Field label="Default account" hint="Used for rows without an account column value.">
            <Select value={defaultAccountId ?? ''} onChange={(e) => setDefaultAccountId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">None</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          {previewMut.error && <ErrorNote error={new Error(apiErrorMessage(previewMut.error))} />}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!csv.trim() || previewMut.isPending} onClick={() => runPreview()}>
              {previewMut.isPending ? 'Reading…' : 'Continue'}
            </Button>
          </div>
        </div>
      )}

      {step === 'map' && preview && (
        <div className="space-y-5">
          <fieldset>
            <legend className="label mb-2">Column mapping {filename && <span className="normal-case tracking-normal text-faint">· {filename}</span>}</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {IMPORT_FIELDS.map((field) => (
                <Field key={field} label={FIELD_LABEL[field]}>
                  <Select value={mapping[field] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value || undefined }))}>
                    <option value="">Not mapped</option>
                    {preview.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
              <Field label="Default account">
                <Select value={defaultAccountId ?? ''} onChange={(e) => setDefaultAccountId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">None</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-3">
              <Button size="sm" onClick={() => runPreview(Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)) as ImportMapping)} disabled={previewMut.isPending}>
                {previewMut.isPending ? 'Validating…' : 'Apply mapping & re-validate'}
              </Button>
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-border py-3 text-sm">
            <span>
              <span className="num text-foreground">{preview.rows.length}</span> <span className="text-muted">rows</span>
            </span>
            <span>
              <span className="num text-pos-text">{preview.validCount}</span> <span className="text-muted">valid</span>
            </span>
            <span>
              <span className={clsx('num', preview.errorCount ? 'text-neg-text' : 'text-foreground')}>{preview.errorCount}</span> <span className="text-muted">with errors</span>
            </span>
            <span>
              <span className="num text-foreground">{preview.duplicateCount}</span> <span className="text-muted">possible duplicates</span>
            </span>
            <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only rows with issues
            </label>
          </div>

          <div className="max-h-[45vh] overflow-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <caption className="sr-only">Import preview</caption>
              <thead className="sticky top-0 bg-surface-2">
                <tr className="text-left text-muted">
                  {['Row', 'Status', 'Date', 'Type', 'Instrument', 'Account', 'Qty', 'Price', 'Fees', 'Messages'].map((h) => (
                    <th key={h} scope="col" className={clsx('px-2 py-1.5 font-medium', ['Qty', 'Price', 'Fees'].includes(h) && 'text-right')}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const dup = r.duplicateOfTxnId || r.duplicateInFile
                  const acc = accounts.find((a) => a.id === r.parsed?.accountId)?.name
                  return (
                    <tr key={r.rowNumber} className="border-t border-border/60 align-top">
                      <td className="num px-2 py-1.5 text-muted">{r.rowNumber}</td>
                      <td className="px-2 py-1.5">
                        {r.errors.length ? <Chip tone="avoid">Error</Chip> : dup ? <Chip tone="watch">Duplicate</Chip> : <Chip tone="strong">OK</Chip>}
                      </td>
                      <td className="num px-2 py-1.5">{r.parsed ? fmtDate(r.parsed.tradeDate) : '—'}</td>
                      <td className="px-2 py-1.5">{r.parsed ? TXN_TYPE_LABEL[r.parsed.type] : '—'}</td>
                      <td className="px-2 py-1.5">{r.parsed?.instrumentId ?? '—'}</td>
                      <td className="px-2 py-1.5">{acc ?? '—'}</td>
                      <td className="num px-2 py-1.5 text-right">{fmtNum(r.parsed?.quantity, 4)}</td>
                      <td className="num px-2 py-1.5 text-right">{fmtUsd(r.parsed?.price, 4)}</td>
                      <td className="num px-2 py-1.5 text-right">{fmtUsd(r.parsed?.fees)}</td>
                      <td className="px-2 py-1.5">
                        {r.errors.map((m) => (
                          <p key={m} className="text-neg-text">{m}</p>
                        ))}
                        {r.warnings.map((m) => (
                          <p key={m} className="text-muted">{m}</p>
                        ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {commit.error && <ErrorNote error={new Error(apiErrorMessage(commit.error))} />}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} /> Skip possible duplicates
            </label>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep('upload')}>
                Back
              </Button>
              <Button
                variant="primary"
                disabled={preview.errorCount > 0 || toImport === 0 || commit.isPending}
                title={preview.errorCount > 0 ? 'Fix the mapping or the file: rows with errors cannot be committed' : undefined}
                onClick={() =>
                  commit.mutate(
                    { csv, mapping: mapping as Record<string, string>, defaultAccountId, filename, skipDuplicates },
                    {
                      onSuccess: (r) => {
                        setResult(r)
                        setStep('done')
                      },
                    },
                  )
                }
              >
                {commit.isPending ? 'Committing…' : `Commit ${toImport} ${toImport === 1 ? 'row' : 'rows'}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="space-y-4">
          <p className="text-sm text-foreground">
            Imported <span className="num">{result.inserted}</span> transactions as batch <code className="num rounded bg-surface-2 px-1">{result.batch.id}</code>
            {result.skipped > 0 && (
              <>
                {' '}
                (<span className="num">{result.skipped}</span> skipped)
              </>
            )}
            . NAV, holdings and performance are being recomputed.
          </p>
          {rollback.isSuccess ? (
            <p className="text-sm text-muted">Batch rolled back; its transactions were removed.</p>
          ) : (
            <p className="text-xs text-muted">Made a mistake? Rolling the batch back removes every transaction it created (the audit log keeps a copy).</p>
          )}
          {rollback.error && <ErrorNote error={new Error(apiErrorMessage(rollback.error))} />}
          <div className="flex justify-end gap-2">
            {!rollback.isSuccess && (
              <Button variant="danger" disabled={rollback.isPending} onClick={() => rollback.mutate(result.batch.id)}>
                Roll back this batch
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
