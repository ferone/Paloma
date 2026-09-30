import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CASH_AMOUNT_TYPES, TXN_TYPES, TXN_TYPE_LABEL, type Transaction, type TransactionsQuery, type TxnType } from '@shared/portfolio'
import { fmtDate, fmtNum, fmtUsd, fmtUsdSigned } from '../../../design/format'
import { signColor } from '../../../design/tokens'
import { Button, Chip, DataTable, EmptyState, ErrorNote, Field, Input, Panel, PanelSkeleton, Select, type Column } from '../../../ui'
import { apiErrorMessage, exportUrl, useAccounts, useDeleteTransaction, useInstruments, useTransactions } from '../api'
import { Drawer } from '../components/Drawer'
import { AccountsPanel, BatchesPanel, SettingsPanel } from '../components/FundSetup'
import { ImportWizard } from '../components/ImportWizard'
import { TransactionForm } from '../components/TransactionForm'

/** Signed cash effect of a transaction (what hits the cash ledger). */
function cashEffect(t: Transaction): number | null {
  const gross = t.quantity * t.price
  switch (t.type) {
    case 'buy':
      return -(gross + t.fees)
    case 'sell':
      return gross - t.fees
    case 'subscription':
    case 'dividend':
    case 'interest':
      return gross - t.fees
    case 'redemption':
    case 'fee':
    case 'storage_fee':
      return -(gross + t.fees)
    case 'futures_open':
    case 'futures_close':
      return t.fees ? -t.fees : null
    default:
      return t.instrumentId === 'USD' && (t.type === 'deposit' || t.type === 'withdrawal') ? (t.type === 'deposit' ? gross : -gross) : null
  }
}

export default function LedgerPage() {
  const [params, setParams] = useSearchParams()
  const [filters, setFilters] = useState<TransactionsQuery>({})
  const txns = useTransactions(filters)
  const accounts = useAccounts()
  const instruments = useInstruments()
  const del = useDeleteTransaction()
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [importing, setImporting] = useState(false)
  const creating = params.get('new') === '1'
  const setCreating = (v: boolean) =>
    setParams(
      (p) => {
        if (v) p.set('new', '1')
        else p.delete('new')
        return p
      },
      { replace: true },
    )

  const accName = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a.name])), [accounts.data])
  const rows = txns.data ?? []
  const hasFilters = Object.values(filters).some((v) => v != null && v !== '')
  const setFilter = (k: keyof TransactionsQuery, v: string) => setFilters((f) => ({ ...f, [k]: v || undefined }))

  const columns: Column<Transaction>[] = [
    { key: 'date', header: 'Date', cell: (t) => <span className="num">{fmtDate(t.tradeDate)}</span>, sortValue: (t) => `${t.tradeDate}-${String(t.id).padStart(8, '0')}` },
    { key: 'type', header: 'Type', cell: (t) => TXN_TYPE_LABEL[t.type], sortValue: (t) => t.type },
    { key: 'inst', header: 'Instrument', cell: (t) => <span className="font-medium text-foreground">{t.instrumentId}</span>, sortValue: (t) => t.instrumentId },
    {
      key: 'acct',
      header: 'Account',
      cell: (t) => (
        <span className="text-muted">
          {accName.get(t.accountId) ?? t.accountId}
          {t.counterAccountId && <> → {accName.get(t.counterAccountId) ?? t.counterAccountId}</>}
        </span>
      ),
    },
    { key: 'qty', header: 'Quantity', numeric: true, cell: (t) => fmtNum(t.quantity, CASH_AMOUNT_TYPES.includes(t.type) ? 2 : t.instrumentId.endsWith('PHYS') ? 3 : 0), sortValue: (t) => t.quantity },
    { key: 'price', header: 'Price', numeric: true, cell: (t) => (CASH_AMOUNT_TYPES.includes(t.type) || t.type === 'transfer' ? '' : fmtUsd(t.price)), sortValue: (t) => t.price },
    { key: 'fees', header: 'Fees', numeric: true, cell: (t) => (t.fees ? fmtUsd(t.fees) : ''), sortValue: (t) => t.fees },
    {
      key: 'cash',
      header: 'Cash effect',
      numeric: true,
      cell: (t) => {
        const c = cashEffect(t)
        return <span className={signColor(c)}>{c == null ? '—' : fmtUsdSigned(c)}</span>
      },
      sortValue: (t) => cashEffect(t),
    },
    {
      key: 'notes',
      header: 'Notes',
      className: 'max-w-[18rem]',
      cell: (t) => (
        <span className="flex items-center gap-2">
          {t.importBatch && <Chip title={t.importBatch}>Imported</Chip>}
          <span className="truncate text-xs text-muted" title={t.notes ?? undefined}>
            {t.notes}
          </span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (t) => (
        <span className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label={`Edit transaction ${t.id}`}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Delete transaction ${t.id}`}
            onClick={() => {
              if (confirm(`Delete ${TXN_TYPE_LABEL[t.type].toLowerCase()} of ${t.instrumentId} on ${fmtDate(t.tradeDate)}? NAV history will be recomputed.`)) del.mutate(t.id)
            }}
          >
            Delete
          </Button>
        </span>
      ),
    },
  ]

  const noAccounts = accounts.data?.length === 0
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-6">
        <Panel
          title="Transactions"
          eyebrow={txns.data ? `${rows.length} ${hasFilters ? 'matching' : 'recorded'}` : 'Ledger'}
          actions={
            <>
              <a href={exportUrl(filters)} className="inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground" download>
                Export CSV
              </a>
              <Button size="sm" onClick={() => setImporting(true)} disabled={noAccounts}>
                Import CSV
              </Button>
              <Button size="sm" variant="primary" onClick={() => setCreating(true)} disabled={noAccounts}>
                New transaction
              </Button>
            </>
          }
          provenance={{ source: 'Fund ledger (SQLite) · every change is audit-logged', note: 'Edits and deletes trigger a full NAV recompute' }}
        >
          <form className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6" onSubmit={(e) => e.preventDefault()} aria-label="Filter transactions">
            <Field label="From">
              <Input type="date" value={filters.from ?? ''} onChange={(e) => setFilter('from', e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={filters.to ?? ''} onChange={(e) => setFilter('to', e.target.value)} />
            </Field>
            <Field label="Type">
              <Select value={filters.type ?? ''} onChange={(e) => setFilters((f) => ({ ...f, type: (e.target.value || undefined) as TxnType | undefined }))}>
                <option value="">All types</option>
                {TXN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TXN_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Instrument">
              <Select value={filters.instrumentId ?? ''} onChange={(e) => setFilter('instrumentId', e.target.value)}>
                <option value="">All instruments</option>
                {(instruments.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.id}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Account">
              <Select value={filters.accountId ?? ''} onChange={(e) => setFilters((f) => ({ ...f, accountId: e.target.value ? Number(e.target.value) : undefined }))}>
                <option value="">All accounts</option>
                {(accounts.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Search notes">
              <Input type="search" value={filters.q ?? ''} onChange={(e) => setFilter('q', e.target.value)} placeholder="e.g. rebalance" />
            </Field>
          </form>
          {del.error && <div className="mb-3"><ErrorNote error={new Error(apiErrorMessage(del.error))} /></div>}
          {txns.isLoading ? (
            <PanelSkeleton rows={8} />
          ) : txns.error ? (
            <ErrorNote error={txns.error} onRetry={() => txns.refetch()} />
          ) : rows.length === 0 && !hasFilters ? (
            <EmptyState
              title="No transactions recorded yet"
              action={
                noAccounts ? undefined : (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    Record your first transaction
                  </Button>
                )
              }
            >
              {noAccounts
                ? 'Start by adding the account where the first subscription settles (panel on the right), then record your first transaction or import a CSV.'
                : 'Record the first subscription, then the trades it funded, or import a broker CSV.'}
            </EmptyState>
          ) : (
            <div className={clsx(txns.isPlaceholderData && 'opacity-60')}>
              <DataTable dense columns={columns} rows={rows} rowKey={(t) => String(t.id)} initialSort={{ key: 'date', dir: 'desc' }} empty="No transactions match these filters." caption="Ledger transactions" />
            </div>
          )}
        </Panel>
        <BatchesPanel />
      </div>
      <div className="space-y-6">
        {accounts.data && <AccountsPanel accounts={accounts.data} />}
        <SettingsPanel />
      </div>

      <Drawer open={(creating || !!editing) && !!accounts.data && !!instruments.data} onClose={() => (editing ? setEditing(null) : setCreating(false))} eyebrow="Ledger" title={editing ? `Edit transaction #${editing.id}` : 'New transaction'}>
        {accounts.data && instruments.data && (
          <TransactionForm
            key={editing?.id ?? 'new'}
            initial={editing}
            accounts={accounts.data}
            instruments={instruments.data}
            defaultType={rows.length === 0 ? 'subscription' : 'buy'}
            onDone={() => (editing ? setEditing(null) : setCreating(false))}
          />
        )}
      </Drawer>
      <Drawer open={importing} onClose={() => setImporting(false)} eyebrow="Ledger" title="Import transactions from CSV" width="lg">
        <ImportWizard accounts={accounts.data ?? []} onClose={() => setImporting(false)} />
      </Drawer>
    </div>
  )
}
