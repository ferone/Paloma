import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import { RiEqualizerLine } from 'react-icons/ri'
import { UNIVERSE, type AssetId } from '@shared/universe'
import { useQuoteMap } from '../features/markets/hooks'
import { fmtNum, fmtPctSigned, fmtRatio } from '../design/format'
import { signColor } from '../design/tokens'
import { useSettings } from '../store/settings-context'
import { resolveTicker, selectedKeys, tickerCatalog, tickerSymbols, toggleTickerKey, useTickerConfig, type TickerConfig, type TickerItem } from './tickerConfig'

type PriceOf = (symbol: string) => { price: number; changePercent?: number } | undefined

/**
 * Top-bar quote strip. By default: the asset in focus, gold and bitcoin and
 * one ratio, with every other item behind a "+N" overflow menu; a custom
 * selection (chosen here or in Settings) is shown in full. Assets show the
 * 24/7 display quote when they have one, else their reference spot.
 */
export function TickerStrip() {
  const { asset, setAsset } = useSettings()
  const [cfg, setCfg] = useTickerConfig()
  const { visible, overflow } = resolveTicker(cfg, asset)
  const quotes = useQuoteMap(tickerSymbols([...visible, ...overflow]))
  const price: PriceOf = (symbol) => quotes.get(symbol)?.data

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <dl className="flex min-w-0 items-center gap-5 overflow-x-auto text-xs" aria-label="Market tickers">
        {visible.map((item) => (
          <TickerValue key={item.key} item={item} price={price} />
        ))}
      </dl>
      {overflow.length > 0 && <OverflowMenu items={overflow} price={price} onFocusAsset={setAsset} />}
      <TickerSettings cfg={cfg} focus={asset} onChange={setCfg} />
    </div>
  )
}

function quoteOf(item: TickerItem, price: PriceOf): { value: string; change: number | null } {
  if (item.kind === 'asset') {
    const spec = UNIVERSE[item.asset]
    const q = price(spec.displaySpot ?? spec.spot)
    return { value: q?.price ? `$${fmtNum(q.price, spec.displayDecimals)}` : '—', change: q?.changePercent ?? null }
  }
  const n = price(UNIVERSE[item.pair.numerator].spot)
  const d = price(UNIVERSE[item.pair.denominator].spot)
  return { value: fmtRatio(n && d && d.price > 0 ? n.price / d.price : null), change: null }
}

function TickerValue({ item, price }: { item: TickerItem; price: PriceOf }) {
  const q = quoteOf(item, price)
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap" title={item.title}>
      <dt className="text-muted">{item.label}</dt>
      <dd className="num text-foreground">{q.value}</dd>
      {item.kind === 'asset' && <dd className={clsx('num', signColor(q.change ?? undefined))}>{q.change != null ? fmtPctSigned(q.change / 100) : ''}</dd>}
    </div>
  )
}

/**
 * "+N" menu with the items not shown up front. Keyboard: Enter/Space/↓ opens
 * on the first item, ↑/↓ move, Home/End jump, Escape (or Tab) closes and
 * returns focus. Choosing an asset puts it in focus (it then leads the strip).
 */
function OverflowMenu({ items, price, onFocusAsset }: { items: TickerItem[]; price: PriceOf; onFocusAsset: (a: AssetId) => void }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open) menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[active]?.focus()
  }, [open, active])

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }
  const openAt = (i: number) => {
    setActive(i)
    setOpen(true)
  }
  const choose = (item: TickerItem) => {
    if (item.kind === 'asset') onFocusAsset(item.asset)
    close()
  }

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openAt(0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      openAt(items.length - 1)
    }
  }
  const onMenuKey = (e: KeyboardEvent) => {
    const last = items.length - 1
    if (e.key === 'ArrowDown') setActive((i) => (i >= last ? 0 : i + 1))
    else if (e.key === 'ArrowUp') setActive((i) => (i <= 0 ? last : i - 1))
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(last)
    else if (e.key === 'Escape') close()
    else if (e.key === 'Tab') return close(false)
    else if (e.key === 'Enter' || e.key === ' ') choose(items[active])
    else return
    e.preventDefault()
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${items.length} more tickers`}
        title={`${items.length} more tickers`}
        onClick={() => (open ? close() : openAt(0))}
        onKeyDown={onButtonKey}
        className={clsx(
          'num rounded-md border border-border px-1.5 py-0.5 text-2xs transition-colors hover:bg-surface-2 hover:text-foreground pointer-coarse:px-3 pointer-coarse:py-2',
          open ? 'bg-surface-2 text-foreground' : 'text-muted',
        )}
      >
        +{items.length}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="More tickers"
          onKeyDown={onMenuKey}
          className="absolute left-0 top-full z-50 mt-1.5 max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-border bg-surface-3 py-1 shadow-lg max-sm:-left-24"
        >
          {items.map((item, i) => {
            const q = quoteOf(item, price)
            return (
              <div
                key={item.key}
                role="menuitem"
                tabIndex={i === active ? 0 : -1}
                title={item.kind === 'asset' ? `Put ${item.title} in focus` : item.title}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
                className={clsx(
                  'flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-xs outline-none',
                  i === active ? 'bg-surface-2 text-foreground' : 'text-muted',
                )}
              >
                <span className="num w-14 shrink-0 text-foreground">{item.label}</span>
                <span className="min-w-0 flex-1 truncate text-2xs text-faint">{item.title}</span>
                <span className="num text-foreground">{q.value}</span>
                {item.kind === 'asset' && (
                  <span className={clsx('num w-14 text-right', signColor(q.change ?? undefined))}>{q.change != null ? fmtPctSigned(q.change / 100) : ''}</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Checkbox list of every ticker item plus "Reset to default". Shared by the
 * top-bar popover and Settings → Top-bar tickers.
 */
export function TickerChooser({ cfg, focus, onChange, compact = false }: { cfg: TickerConfig; focus: AssetId; onChange: (c: TickerConfig) => void; compact?: boolean }) {
  const on = new Set(selectedKeys(cfg, focus))
  const catalog = tickerCatalog()
  const groups: { label: string; items: TickerItem[] }[] = [
    { label: 'Assets', items: catalog.filter((i) => i.kind === 'asset') },
    { label: 'Ratios', items: catalog.filter((i) => i.kind === 'pair') },
  ].filter((g) => g.items.length)

  return (
    <div>
      <div className={clsx(!compact && 'grid gap-4 sm:grid-cols-2')}>
        {groups.map((g) => (
          <fieldset key={g.label} className={clsx(compact && 'px-3 pb-1 pt-2')}>
            <legend className="label pb-1 text-faint">{g.label}</legend>
            {g.items.map((i) => (
              <label key={i.key} className="flex cursor-pointer items-center gap-2.5 py-1 text-[13px] text-muted hover:text-foreground">
                <input type="checkbox" className="size-3.5 accent-brand" checked={on.has(i.key)} onChange={() => onChange(toggleTickerKey(cfg, focus, i.key))} />
                <span className="num w-12 text-foreground">{i.label}</span>
                <span className="truncate text-2xs text-faint">{i.title}</span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border', compact ? 'mt-1 px-3 pb-1 pt-2' : 'mt-4 pt-3')}>
        <button
          type="button"
          disabled={cfg.mode === 'default'}
          onClick={() => onChange({ mode: 'default' })}
          className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline disabled:cursor-default disabled:opacity-50 disabled:no-underline"
        >
          Reset to default
        </button>
        <span className="text-2xs text-faint">{cfg.mode === 'default' ? 'Default: follows the asset in focus' : 'Custom selection'}</span>
      </div>
    </div>
  )
}

/** Popover with the chooser. Escape or an outside click closes it. */
function TickerSettings({ cfg, focus, onChange }: { cfg: TickerConfig; focus: AssetId; onChange: (c: TickerConfig) => void }) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const id = useId()

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
    <div className="relative ml-auto shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        title="Choose tickers"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-foreground pointer-coarse:p-2.5"
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
          className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-md border border-border bg-surface-3 py-1 shadow-lg"
        >
          <TickerChooser cfg={cfg} focus={focus} onChange={onChange} compact />
        </div>
      )}
    </div>
  )
}
