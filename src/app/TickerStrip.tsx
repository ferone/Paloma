import { useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import { RiEqualizerLine } from 'react-icons/ri'
import { UNIVERSE } from '@shared/universe'
import { useQuoteMap } from '../features/markets/hooks'
import { fmtNum, fmtPctSigned, fmtRatio } from '../design/format'
import { signColor } from '../design/tokens'
import { defaultTickerKeys, readTickerConfig, tickerCatalog, tickerItems, tickerSymbols, toggleTickerKey, writeTickerConfig, type TickerItem, type TickerKey } from './tickerConfig'

/**
 * Top-bar quote strip: each selected asset's short label, price and change
 * (the 24/7 display quote when the asset has one, else its reference spot) and
 * each selected relative-value ratio. The selection is persisted per browser.
 */
export function TickerStrip() {
  const [keys, setKeys] = useState<TickerKey[]>(readTickerConfig)
  const items = tickerItems(keys)
  const quotes = useQuoteMap(tickerSymbols(items))
  const price = (symbol: string) => quotes.get(symbol)?.data

  const update = (next: TickerKey[]) => {
    setKeys(next)
    writeTickerConfig(next)
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <dl className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto text-xs" aria-label="Market tickers">
        {items.map((item) => {
          if (item.kind === 'asset') {
            const spec = UNIVERSE[item.asset]
            const q = price(spec.displaySpot ?? spec.spot)
            return <Ticker key={item.key} label={item.label} title={item.title} price={q?.price} decimals={spec.displayDecimals} change={q?.changePercent} />
          }
          const n = price(UNIVERSE[item.pair.numerator].spot)
          const d = price(UNIVERSE[item.pair.denominator].spot)
          const ratio = n && d && d.price > 0 ? n.price / d.price : null
          return (
            <div key={item.key} className="flex items-baseline gap-1.5 whitespace-nowrap" title={item.title}>
              <dt className="text-muted">{item.label}</dt>
              <dd className="num text-foreground">{fmtRatio(ratio)}</dd>
            </div>
          )
        })}
      </dl>
      <TickerSettings keys={keys} onChange={update} />
    </div>
  )
}

function Ticker({ label, title, price, decimals, change }: { label: string; title: string; price?: number; decimals: number; change?: number }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap" title={title}>
      <dt className="text-muted">{label}</dt>
      <dd className="num text-foreground">{price ? `$${fmtNum(price, decimals)}` : '—'}</dd>
      <dd className={clsx('num', signColor(change))}>{change != null ? fmtPctSigned(change / 100) : ''}</dd>
    </div>
  )
}

/** Popover with one checkbox per ticker item. Escape or an outside click closes it. */
function TickerSettings({ keys, onChange }: { keys: TickerKey[]; onChange: (k: TickerKey[]) => void }) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const catalog = tickerCatalog()
  const groups: { label: string; items: TickerItem[] }[] = [
    { label: 'Assets', items: catalog.filter((i) => i.kind === 'asset') },
    { label: 'Ratios', items: catalog.filter((i) => i.kind === 'pair') },
  ].filter((g) => g.items.length)
  const isDefault = keys.join() === defaultTickerKeys().join()

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector('input')?.focus()
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        title="Choose tickers"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <RiEqualizerLine size={14} />
        <span className="sr-only">Choose tickers</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label="Choose tickers"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false)
              buttonRef.current?.focus()
            }
          }}
          className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-md border border-border bg-surface-3 py-1 shadow-lg"
        >
          {groups.map((g) => (
            <fieldset key={g.label} className="px-3 pb-1 pt-2">
              <legend className="label pb-1 text-faint">{g.label}</legend>
              {g.items.map((i) => (
                <label key={i.key} className="flex cursor-pointer items-center gap-2.5 py-1 text-[13px] text-muted hover:text-foreground">
                  <input type="checkbox" className="size-3.5 accent-brand" checked={keys.includes(i.key)} onChange={() => onChange(toggleTickerKey(keys, i.key))} />
                  <span className="num w-12 text-foreground">{i.label}</span>
                  <span className="truncate text-2xs text-faint">{i.title}</span>
                </label>
              ))}
            </fieldset>
          ))}
          <div className="mt-1 border-t border-border px-3 pb-1 pt-2">
            <button
              type="button"
              disabled={isDefault}
              onClick={() => onChange(defaultTickerKeys())}
              className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline disabled:cursor-default disabled:opacity-50 disabled:no-underline"
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
