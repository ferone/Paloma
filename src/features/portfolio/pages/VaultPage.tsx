import { useState, type FormEvent } from 'react'
import {
  BULLION_FORMS,
  BULLION_WEIGHT_UNITS,
  CUSTODY_LABEL,
  physicalItemInputSchema,
  physicalQuantity,
  type Account,
  type CustodyType,
  type PhysicalForm,
  type PhysicalItemView,
  type WeightUnit,
} from '@shared/portfolio'
import { UNIVERSE, physicalAssets, type AssetId, type PhysicalSpec } from '@shared/universe'
import { fmtDate, fmtNum, fmtPct, fmtUsd } from '../../../design/format'
import { Button, Chip, DataTable, EmptyState, ErrorNote, Field, Input, Panel, PanelSkeleton, Select, Stat, Textarea, type Column } from '../../../ui'
import { apiErrorMessage, useAccounts, useDeletePhysical, useSavePhysical, useVault } from '../api'
import { Warnings } from '../components/common'
import { Drawer } from '../components/Drawer'
import { fmtQty, qtyDigits } from '../components/units'

/** Physical spec of a register asset (every register item's asset has one). */
function physOf(asset: AssetId): PhysicalSpec {
  return UNIVERSE[asset].physical ?? { unit: 'oz', kind: 'bullion', instrumentId: '' }
}

/** Accounts that normally hold each kind of direct holding. */
const HOME_CUSTODY: Record<PhysicalSpec['kind'], CustodyType[]> = { bullion: ['vault'], custody: ['wallet', 'exchange'] }

export default function VaultPage() {
  const vault = useVault()
  const accounts = useAccounts()
  const del = useDeletePhysical()
  const [editing, setEditing] = useState<PhysicalItemView | 'new' | null>(null)

  if (vault.isLoading) return <Panel><PanelSkeleton rows={6} /></Panel>
  if (vault.error) return <ErrorNote error={vault.error} onRetry={() => vault.refetch()} />
  const v = vault.data!

  const columns: Column<PhysicalItemView>[] = [
    {
      key: 'desc',
      header: 'Item',
      cell: (i) => (
        <span>
          <span className="text-foreground">{i.description}</span>
          <span className="ml-2 text-xs text-muted">{i.refiner}</span>
          {i.status === 'sold' && <Chip className="ml-2">Sold</Chip>}
        </span>
      ),
      sortValue: (i) => i.description,
    },
    { key: 'asset', header: 'Asset', cell: (i) => UNIVERSE[i.asset]?.label ?? i.asset, sortValue: (i) => i.asset },
    { key: 'serial', header: 'Serial / ref.', cell: (i) => <span className="num text-xs">{i.serial ?? '—'}</span> },
    { key: 'vault', header: 'Location', cell: (i) => <span className="text-muted">{i.accountName ?? '—'}</span> },
    { key: 'gross', header: 'Weight / balance', numeric: true, cell: (i) => fmtQty(i.weight, i.weightUnit, i.weightUnit === 'g' ? 1 : qtyDigits(i.asset)) },
    { key: 'purity', header: 'Fineness', numeric: true, cell: (i) => (physOf(i.asset).kind === 'bullion' ? fmtNum(i.purity * 1000, 1) : '—') },
    { key: 'fine', header: 'Fine quantity', numeric: true, cell: (i) => fmtQty(i.fineQty, physOf(i.asset).unit, qtyDigits(i.asset)), sortValue: (i) => i.fineQty },
    { key: 'value', header: 'Value', numeric: true, cell: (i) => fmtUsd(i.value, 0), sortValue: (i) => i.value },
    { key: 'premium', header: 'Premium paid', numeric: true, cell: (i) => fmtUsd(i.premiumPaid, 0) },
    { key: 'storage', header: 'Storage accrued', numeric: true, cell: (i) => (i.storageFeeRateAnnual ? fmtUsd(i.storageAccrued, 0) : '—') },
    { key: 'acq', header: 'Acquired', cell: (i) => <span className="num text-xs">{fmtDate(i.acquiredDate)}</span>, sortValue: (i) => i.acquiredDate },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (i) => (
        <span className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(i)} aria-label={`Edit ${i.description}`}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Delete ${i.description}`}
            onClick={() => {
              if (confirm(`Remove "${i.description}" from the register? The linked ledger purchase is kept.`)) del.mutate(i.id)
            }}
          >
            Delete
          </Button>
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      {v.totals.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          {v.totals.map((t) => (
            <Panel key={t.asset} eyebrow={UNIVERSE[t.asset]?.label ?? t.asset} provenance={v.provenance}>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                <Stat
                  size="hero"
                  label={physOf(t.asset).kind === 'bullion' ? `Fine ${t.unitLabel}` : `Balance (${t.unitLabel})`}
                  value={fmtNum(t.fineQty, qtyDigits(t.asset))}
                  className="col-span-2"
                  hint={`${t.items} ${t.items === 1 ? 'item' : 'items'} · ledger ${fmtQty(t.ledgerQty, t.unitLabel, qtyDigits(t.asset))}`}
                />
                <Stat label="Value" value={fmtUsd(t.value, 0)} hint={v.haircut ? `after ${fmtPct(v.haircut)} haircut` : undefined} />
                <Stat label="Storage accrued" value={fmtUsd(t.storageAccrued, 0)} hint={`Premiums paid ${fmtUsd(t.premiumPaid, 0)}`} />
              </div>
            </Panel>
          ))}
        </div>
      )}
      <Warnings items={v.warnings} />
      <Panel
        title="Physical register"
        eyebrow="Allocated bullion and custody balances"
        actions={
          <Button size="sm" variant="primary" onClick={() => setEditing('new')} disabled={!accounts.data?.length}>
            Add item
          </Button>
        }
        provenance={v.provenance}
      >
        {del.error && <ErrorNote error={new Error(apiErrorMessage(del.error))} />}
        {v.items.length === 0 ? (
          <EmptyState
            title="The vault register is empty"
            action={
              accounts.data?.length ? (
                <Button variant="primary" onClick={() => setEditing('new')}>
                  Register a bar or coin
                </Button>
              ) : undefined
            }
          >
            Record each allocated bar or coin with its serial, fineness and custodian, or a custody balance with its wallet or exchange account. Registering a purchase also records the matching buy on the ledger.
          </EmptyState>
        ) : (
          <DataTable columns={columns} rows={v.items} rowKey={(i) => String(i.id)} caption="Physical register" dense />
        )}
      </Panel>
      <Drawer open={editing != null && !!accounts.data} onClose={() => setEditing(null)} eyebrow="Vault" title={editing === 'new' ? 'Register a holding' : 'Edit register item'}>
        {editing != null && accounts.data && <PhysicalForm item={editing === 'new' ? null : editing} accounts={accounts.data} onDone={() => setEditing(null)} />}
      </Drawer>
    </div>
  )
}

function PhysicalForm({ item, accounts, onDone }: { item: PhysicalItemView | null; accounts: Account[]; onDone: () => void }) {
  const save = useSavePhysical()
  const initialAsset = item?.asset ?? physicalAssets()[0]
  const homeAccount = (asset: AssetId) => accounts.find((a) => HOME_CUSTODY[physOf(asset).kind].includes(a.custody)) ?? accounts[0]
  const [f, setF] = useState({
    asset: initialAsset,
    form: (item?.form ?? (physOf(initialAsset).kind === 'custody' ? 'balance' : 'bar')) as PhysicalForm,
    description: item?.description ?? '',
    weight: item ? String(item.weight) : '',
    weightUnit: (item?.weightUnit ?? physOf(initialAsset).unit) as WeightUnit,
    purity: item ? String(item.purity) : physOf(initialAsset).kind === 'custody' ? '1' : '0.9999',
    serial: item?.serial ?? '',
    refiner: item?.refiner ?? '',
    accountId: String(item?.accountId ?? homeAccount(initialAsset)?.id ?? ''),
    acquiredDate: item?.acquiredDate ?? new Date().toISOString().slice(0, 10),
    premiumPaid: item?.premiumPaid != null ? String(item.premiumPaid) : '',
    storageRate: item?.storageFeeRateAnnual != null ? String(item.storageFeeRateAnnual * 100) : '',
    status: item?.status ?? 'held',
    notes: item?.notes ?? '',
    record: !item,
    totalCost: '',
    fees: '0',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const phys = physOf(f.asset)
  const custody = phys.kind === 'custody'
  // Switching between bullion and custody assets resets the unit-specific fields.
  const setAsset = (e: { target: { value: string } }) => {
    const asset = e.target.value as AssetId
    const next = physOf(asset)
    setF((s) => {
      if (next.kind === physOf(s.asset).kind) return { ...s, asset }
      const acc = homeAccount(asset)
      return next.kind === 'custody'
        ? { ...s, asset, form: 'balance', weightUnit: next.unit, purity: '1', accountId: String(acc?.id ?? s.accountId) }
        : { ...s, asset, form: 'bar', weightUnit: 'oz', purity: '0.9999', accountId: String(acc?.id ?? s.accountId) }
    })
  }
  let fine: number | null = null
  if (Number(f.weight) > 0 && Number(f.purity) > 0) {
    try {
      fine = physicalQuantity(phys, { weight: Number(f.weight), weightUnit: f.weightUnit, purity: Number(f.purity) })
    } catch {
      fine = null
    }
  }
  const fineLabel = custody ? phys.unit : `fine ${phys.unit}`

  function submit(e: FormEvent) {
    e.preventDefault()
    const body = {
      asset: f.asset,
      form: f.form,
      description: f.description,
      weight: Number(f.weight),
      weightUnit: f.weightUnit,
      purity: Number(f.purity),
      serial: f.serial || null,
      refiner: f.refiner || null,
      accountId: f.accountId ? Number(f.accountId) : null,
      acquisitionTxnId: item?.acquisitionTxnId ?? null,
      acquiredDate: f.acquiredDate || null,
      premiumPaid: f.premiumPaid ? Number(f.premiumPaid) : null,
      storageFeeRateAnnual: f.storageRate ? Number(f.storageRate) / 100 : null,
      status: f.status,
      notes: f.notes || null,
      recordPurchase: f.record && !item ? { totalCost: Number(f.totalCost), fees: Number(f.fees || 0), accountId: Number(f.accountId) } : null,
    }
    const p = physicalItemInputSchema.safeParse(body)
    if (!p.success) return setErrors(Object.fromEntries(p.error.issues.map((i) => [String(i.path.at(-1) ?? '_form'), i.message])))
    setErrors({})
    save.mutate({ id: item?.id, body }, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-4" noValidate>
      <Field label="Asset">
        <Select value={f.asset} onChange={setAsset}>
          {physicalAssets().map((a) => (
            <option key={a} value={a}>
              {UNIVERSE[a].label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Form" error={errors.form}>
        <Select value={f.form} onChange={set('form')} disabled={custody}>
          {(custody ? (['balance'] as PhysicalForm[]) : BULLION_FORMS).map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Description" className="col-span-2" error={errors.description}>
        <Input value={f.description} onChange={set('description')} placeholder={custody ? 'e.g. Cold storage multisig' : 'e.g. 1 kg cast bar'} />
      </Field>
      {custody ? (
        <Field label={`Balance (${phys.unit})`} error={errors.weight}>
          <Input type="number" step="any" min={0} value={f.weight} onChange={set('weight')} />
        </Field>
      ) : (
        <Field label="Gross weight" error={errors.weight ?? errors.weightUnit}>
          <div className="flex gap-2">
            <Input type="number" step="any" min={0} value={f.weight} onChange={set('weight')} aria-label="Gross weight" />
            <Select value={f.weightUnit} onChange={set('weightUnit')} className="w-20" aria-label="Weight unit">
              {BULLION_WEIGHT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </div>
        </Field>
      )}
      {!custody && (
        <Field label="Fineness" hint={fine != null ? `${fmtNum(fine, 4)} ${fineLabel}` : 'e.g. 0.9999'} error={errors.purity}>
          <Input type="number" step="any" min={0} max={1} value={f.purity} onChange={set('purity')} />
        </Field>
      )}
      <Field label={custody ? 'Reference (address or account)' : 'Serial'}>
        <Input value={f.serial} onChange={set('serial')} className="num" />
      </Field>
      {!custody && (
        <Field label="Refiner / mint">
          <Input value={f.refiner} onChange={set('refiner')} />
        </Field>
      )}
      <Field label="Location (account)">
        <Select value={f.accountId} onChange={set('accountId')}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {CUSTODY_LABEL[a.custody]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Acquired" error={errors.acquiredDate}>
        <Input type="date" value={f.acquiredDate} onChange={set('acquiredDate')} />
      </Field>
      <Field label="Premium paid (USD)" hint="Over spot, total">
        <Input type="number" step="any" min={0} value={f.premiumPaid} onChange={set('premiumPaid')} />
      </Field>
      <Field label={custody ? 'Custody fee (% / yr)' : 'Storage fee (% / yr)'} error={errors.storageFeeRateAnnual}>
        <Input type="number" step="0.01" min={0} value={f.storageRate} onChange={set('storageRate')} />
      </Field>
      {item && (
        <Field label="Status">
          <Select value={f.status} onChange={set('status')}>
            <option value="held">Held</option>
            <option value="sold">Sold</option>
          </Select>
        </Field>
      )}
      {!item && (
        <fieldset className="col-span-2 rounded-md border border-border p-3">
          <legend className="px-1 text-xs text-muted">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={f.record} onChange={(e) => setF((s) => ({ ...s, record: e.target.checked }))} />
              Also record the purchase on the ledger
            </label>
          </legend>
          {f.record && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Total cost (USD)" hint={fine && Number(f.totalCost) ? `${fmtUsd(Number(f.totalCost) / fine)} per ${fineLabel}` : custody ? 'All-in cost' : 'Metal + premium'} error={errors.totalCost}>
                <Input type="number" step="any" min={0} value={f.totalCost} onChange={set('totalCost')} />
              </Field>
              <Field label="Fees (USD)">
                <Input type="number" step="any" min={0} value={f.fees} onChange={set('fees')} />
              </Field>
              <p className="col-span-2 text-2xs text-muted">Records a buy of {custody ? `the ${phys.unit} balance` : `fine ${phys.unit}`} on the selected account, paid from its cash.</p>
            </div>
          )}
        </fieldset>
      )}
      <Field label="Notes" className="col-span-2">
        <Textarea rows={2} value={f.notes} onChange={set('notes')} />
      </Field>
      {errors._form && <div className="col-span-2"><ErrorNote error={new Error(errors._form)} /></div>}
      {save.error && <div className="col-span-2"><ErrorNote error={new Error(apiErrorMessage(save.error))} /></div>}
      <div className="col-span-2 flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : item ? 'Save changes' : 'Register item'}
        </Button>
      </div>
    </form>
  )
}
