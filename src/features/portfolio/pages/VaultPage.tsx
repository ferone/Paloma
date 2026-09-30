import { useState, type FormEvent } from 'react'
import {
  PHYSICAL_FORMS,
  WEIGHT_UNITS,
  physicalItemInputSchema,
  toTroyOz,
  type Account,
  type PhysicalForm,
  type PhysicalItemView,
  type WeightUnit,
} from '@shared/portfolio'
import type { Metal } from '@shared/universe'
import { fmtDate, fmtNum, fmtOz, fmtPct, fmtUsd } from '../../../design/format'
import { Button, Chip, DataTable, EmptyState, ErrorNote, Field, Input, Panel, PanelSkeleton, Select, Stat, Textarea, type Column } from '../../../ui'
import { apiErrorMessage, useAccounts, useDeletePhysical, useSavePhysical, useVault } from '../api'
import { Warnings } from '../components/common'
import { Drawer } from '../components/Drawer'

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
    { key: 'metal', header: 'Metal', cell: (i) => (i.metal === 'gold' ? 'Gold' : 'Silver'), sortValue: (i) => i.metal },
    { key: 'serial', header: 'Serial', cell: (i) => <span className="num text-xs">{i.serial ?? '—'}</span> },
    { key: 'vault', header: 'Location', cell: (i) => <span className="text-muted">{i.accountName ?? '—'}</span> },
    { key: 'gross', header: 'Weight', numeric: true, cell: (i) => `${fmtNum(i.weight, i.weightUnit === 'g' ? 1 : 3)} ${i.weightUnit}` },
    { key: 'purity', header: 'Fineness', numeric: true, cell: (i) => fmtNum(i.purity * 1000, 1) },
    { key: 'fine', header: 'Fine oz', numeric: true, cell: (i) => fmtNum(i.fineOz, 3), sortValue: (i) => i.fineOz },
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
            <Panel key={t.metal} eyebrow={t.metal === 'gold' ? 'Gold' : 'Silver'} provenance={v.provenance}>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                <Stat size="hero" label="Fine ounces" value={fmtNum(t.fineOz, 3)} className="col-span-2" hint={`${t.items} ${t.items === 1 ? 'item' : 'items'} · ledger ${fmtOz(t.ledgerOz)}`} />
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
        eyebrow="Allocated bars and coins"
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
            Record each allocated bar or coin with its serial, fineness and custodian. Registering a purchase also records the matching buy on the ledger.
          </EmptyState>
        ) : (
          <DataTable columns={columns} rows={v.items} rowKey={(i) => String(i.id)} caption="Physical register" dense />
        )}
      </Panel>
      <Drawer open={editing != null && !!accounts.data} onClose={() => setEditing(null)} eyebrow="Vault" title={editing === 'new' ? 'Register physical metal' : 'Edit vault item'}>
        {editing != null && accounts.data && <PhysicalForm item={editing === 'new' ? null : editing} accounts={accounts.data} onDone={() => setEditing(null)} />}
      </Drawer>
    </div>
  )
}

function PhysicalForm({ item, accounts, onDone }: { item: PhysicalItemView | null; accounts: Account[]; onDone: () => void }) {
  const save = useSavePhysical()
  const vaults = accounts.filter((a) => a.custody === 'vault')
  const [f, setF] = useState({
    metal: (item?.metal ?? 'gold') as Metal,
    form: (item?.form ?? 'bar') as PhysicalForm,
    description: item?.description ?? '',
    weight: item ? String(item.weight) : '',
    weightUnit: (item?.weightUnit ?? 'oz') as WeightUnit,
    purity: item ? String(item.purity) : '0.9999',
    serial: item?.serial ?? '',
    refiner: item?.refiner ?? '',
    accountId: String(item?.accountId ?? vaults[0]?.id ?? accounts[0]?.id ?? ''),
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
  const fine = Number(f.weight) > 0 && Number(f.purity) > 0 ? toTroyOz(Number(f.weight), f.weightUnit) * Number(f.purity) : null

  function submit(e: FormEvent) {
    e.preventDefault()
    const body = {
      metal: f.metal,
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
    if (!p.success) return setErrors(Object.fromEntries(p.error.issues.map((i) => [String(i.path.at(-1) ?? 'form'), i.message])))
    setErrors({})
    save.mutate({ id: item?.id, body }, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-4" noValidate>
      <Field label="Metal">
        <Select value={f.metal} onChange={set('metal')}>
          <option value="gold">Gold</option>
          <option value="silver">Silver</option>
        </Select>
      </Field>
      <Field label="Form">
        <Select value={f.form} onChange={set('form')}>
          {PHYSICAL_FORMS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Description" className="col-span-2" error={errors.description}>
        <Input value={f.description} onChange={set('description')} placeholder="e.g. 1 kg cast bar" />
      </Field>
      <Field label="Gross weight" error={errors.weight}>
        <div className="flex gap-2">
          <Input type="number" step="any" min={0} value={f.weight} onChange={set('weight')} aria-label="Gross weight" />
          <Select value={f.weightUnit} onChange={set('weightUnit')} className="w-20" aria-label="Weight unit">
            {WEIGHT_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </div>
      </Field>
      <Field label="Fineness" hint={fine != null ? `${fmtNum(fine, 4)} fine troy oz` : 'e.g. 0.9999'} error={errors.purity}>
        <Input type="number" step="any" min={0} max={1} value={f.purity} onChange={set('purity')} />
      </Field>
      <Field label="Serial">
        <Input value={f.serial} onChange={set('serial')} className="num" />
      </Field>
      <Field label="Refiner / mint">
        <Input value={f.refiner} onChange={set('refiner')} />
      </Field>
      <Field label="Location (account)">
        <Select value={f.accountId} onChange={set('accountId')}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.custody}
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
      <Field label="Storage fee (% / yr)" error={errors.storageFeeRateAnnual}>
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
              <Field label="Total cost (USD)" hint={fine && Number(f.totalCost) ? `${fmtUsd(Number(f.totalCost) / fine)} per fine oz` : 'Metal + premium'} error={errors.totalCost}>
                <Input type="number" step="any" min={0} value={f.totalCost} onChange={set('totalCost')} />
              </Field>
              <Field label="Fees (USD)">
                <Input type="number" step="any" min={0} value={f.fees} onChange={set('fees')} />
              </Field>
              <p className="col-span-2 text-2xs text-muted">Records a buy of fine ounces on the selected account, paid from its cash.</p>
            </div>
          )}
        </fieldset>
      )}
      <Field label="Notes" className="col-span-2">
        <Textarea rows={2} value={f.notes} onChange={set('notes')} />
      </Field>
      {errors.form && <div className="col-span-2"><ErrorNote error={new Error(errors.form)} /></div>}
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
