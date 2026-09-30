import { useMemo, useState, type FormEvent } from 'react'
import {
  CASH_AMOUNT_TYPES,
  TXN_ALLOWED_KINDS,
  TXN_TYPES,
  TXN_TYPE_LABEL,
  transactionInputSchema,
  type Account,
  type Instrument,
  type Transaction,
  type TxnType,
} from '@shared/portfolio'
import { ASSETS, UNIVERSE } from '@shared/universe'
import { fmtUsd } from '../../../design/format'
import { Button, ErrorNote, Field, Input, Select, Textarea } from '../../../ui'
import { apiErrorMessage, useSaveTransaction } from '../api'

interface Props {
  initial?: Transaction | null
  accounts: Account[]
  instruments: Instrument[]
  defaultType?: TxnType
  onDone: () => void
}

type FormState = {
  type: TxnType
  tradeDate: string
  settleDate: string
  accountId: string
  counterAccountId: string
  instrumentId: string
  quantity: string
  price: string
  fees: string
  notes: string
}

const KIND_GROUP: Record<string, string> = { cash: 'Cash', etf: 'ETFs', equity: 'Miners', future: 'Futures', physical: 'Physical' }

/** Physical spec of a direct-holding instrument (bullion fine oz, or a custody balance unit). */
function physicalOf(inst?: Instrument) {
  return inst?.kind === 'physical' && inst.asset ? UNIVERSE[inst.asset].physical : null
}

function quantityLabel(type: TxnType, inst?: Instrument): string {
  if (CASH_AMOUNT_TYPES.includes(type)) return 'Amount (USD)'
  if (type === 'futures_open') return 'Contracts (+ long, − short)'
  if (type === 'futures_close') return 'Contracts to close'
  if (inst?.kind === 'cash') return 'Amount (USD)'
  const phys = physicalOf(inst)
  if (phys) return phys.kind === 'bullion' ? `Fine ${phys.unit === 'oz' ? 'troy ounces' : phys.unit}` : `Quantity (${phys.unit})`
  return 'Shares'
}

function priceLabel(type: TxnType, inst?: Instrument): string {
  if (inst?.kind === 'future' && inst.asset) return `Price (${UNIVERSE[inst.asset].unitLabel})`
  const phys = physicalOf(inst)
  if (phys) return `All-in price ($/${phys.kind === 'bullion' ? 'fine ' : ''}${phys.unit})`
  if (type === 'deposit' || type === 'withdrawal') return 'Valuation price'
  return 'Price'
}

/** First tradable ETF of the first asset: the default instrument for a new buy. */
const DEFAULT_SECURITY = UNIVERSE[ASSETS[0]].benchmarkEtf

export function TransactionForm({ initial, accounts, instruments, defaultType = 'buy', onDone }: Props) {
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState<FormState>(() => ({
    type: initial?.type ?? defaultType,
    tradeDate: initial?.tradeDate ?? today,
    settleDate: initial?.settleDate ?? '',
    accountId: String(initial?.accountId ?? accounts[0]?.id ?? ''),
    counterAccountId: String(initial?.counterAccountId ?? ''),
    instrumentId: initial?.instrumentId ?? (CASH_AMOUNT_TYPES.includes(defaultType) ? 'USD' : DEFAULT_SECURITY),
    quantity: initial ? String(initial.quantity) : '',
    price: initial ? String(initial.price) : '',
    fees: initial ? String(initial.fees) : '0',
    notes: initial?.notes ?? '',
  }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = useSaveTransaction()

  const allowed = useMemo(() => instruments.filter((i) => TXN_ALLOWED_KINDS[f.type].includes(i.kind)), [instruments, f.type])
  const inst = instruments.find((i) => i.id === f.instrumentId)
  const cashAmount = CASH_AMOUNT_TYPES.includes(f.type) || (inst?.kind === 'cash' && f.type !== 'dividend')
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))

  const onType = (type: TxnType) =>
    setF((s) => {
      const ok = instruments.find((i) => i.id === s.instrumentId && TXN_ALLOWED_KINDS[type].includes(i.kind))
      const first = instruments.find((i) => TXN_ALLOWED_KINDS[type].includes(i.kind))
      return { ...s, type, instrumentId: ok ? s.instrumentId : (first?.id ?? '') }
    })

  const q = Number(f.quantity)
  const p = cashAmount ? 1 : Number(f.price)
  const fees = Number(f.fees || 0)
  const preview =
    Number.isFinite(q) && Number.isFinite(p) && f.quantity !== ''
      ? f.type === 'buy'
        ? -(q * p + fees)
        : f.type === 'sell'
          ? q * p - fees
          : inst?.kind === 'future'
            ? null
            : q * p
      : null

  function submit(e: FormEvent) {
    e.preventDefault()
    const body = {
      type: f.type,
      tradeDate: f.tradeDate,
      settleDate: f.settleDate || null,
      accountId: Number(f.accountId),
      counterAccountId: f.type === 'transfer' && f.counterAccountId ? Number(f.counterAccountId) : null,
      instrumentId: f.instrumentId,
      quantity: q,
      price: cashAmount || f.type === 'transfer' ? 1 : p,
      fees,
      notes: f.notes.trim() || null,
    }
    const parsed = transactionInputSchema.safeParse(body)
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? 'form'), i.message])))
      return
    }
    setErrors({})
    save.mutate({ id: initial?.id, body }, { onSuccess: onDone })
  }

  const groups = [...new Set(allowed.map((i) => i.kind))]
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Type" className="col-span-2">
          <Select value={f.type} onChange={(e) => onType(e.target.value as TxnType)}>
            {TXN_TYPES.map((t) => (
              <option key={t} value={t}>
                {TXN_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Trade date" error={errors.tradeDate}>
          <Input type="date" required value={f.tradeDate} onChange={set('tradeDate')} />
        </Field>
        <Field label="Settle date" hint="Optional" error={errors.settleDate}>
          <Input type="date" value={f.settleDate} onChange={set('settleDate')} />
        </Field>
        <Field label={f.type === 'transfer' ? 'From account' : 'Account'} error={errors.accountId} className={f.type === 'transfer' ? '' : 'col-span-2'}>
          <Select value={f.accountId} onChange={set('accountId')} required>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.custody}
              </option>
            ))}
          </Select>
        </Field>
        {f.type === 'transfer' && (
          <Field label="To account" error={errors.counterAccountId}>
            <Select value={f.counterAccountId} onChange={set('counterAccountId')} required>
              <option value="">Choose…</option>
              {accounts
                .filter((a) => String(a.id) !== f.accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Field label="Instrument" className="col-span-2" error={errors.instrumentId}>
          <Select value={f.instrumentId} onChange={set('instrumentId')} disabled={allowed.length === 1}>
            {groups.map((g) => (
              <optgroup key={g} label={KIND_GROUP[g]}>
                {allowed
                  .filter((i) => i.kind === g)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.id === i.name ? i.id : `${i.id} — ${i.name}`}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label={quantityLabel(f.type, inst)} error={errors.quantity} className={cashAmount || f.type === 'transfer' ? 'col-span-2' : ''}>
          <Input type="number" step="any" inputMode="decimal" required value={f.quantity} onChange={set('quantity')} />
        </Field>
        {!cashAmount && f.type !== 'transfer' && (
          <Field label={priceLabel(f.type, inst)} error={errors.price}>
            <Input type="number" step="any" min={0} inputMode="decimal" required value={f.price} onChange={set('price')} />
          </Field>
        )}
        <Field label="Fees (USD)" error={errors.fees} hint={f.type === 'buy' ? 'Added to lot cost' : f.type === 'sell' ? 'Reduces realized P&L' : undefined}>
          <Input type="number" step="any" min={0} inputMode="decimal" value={f.fees} onChange={set('fees')} />
        </Field>
        <div className="flex items-end pb-2 text-xs text-muted">
          {preview != null && (
            <span>
              Cash effect <span className="num text-foreground">{fmtUsd(preview)}</span>
            </span>
          )}
        </div>
        <Field label="Notes" className="col-span-2">
          <Textarea value={f.notes} onChange={set('notes')} rows={2} />
        </Field>
      </div>
      {errors.form && <ErrorNote error={new Error(errors.form)} />}
      {save.error && <ErrorNote error={new Error(apiErrorMessage(save.error))} />}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={save.isPending || accounts.length === 0}>
          {save.isPending ? 'Saving…' : initial ? 'Save changes' : 'Record transaction'}
        </Button>
      </div>
    </form>
  )
}
