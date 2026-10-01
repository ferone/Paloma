import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import { RiArrowDownSLine, RiCheckLine } from 'react-icons/ri'
import { ASSETS, ASSET_CLASS_LABEL, UNIVERSE, type AssetClass, type AssetId } from '@shared/universe'
import { useSettings } from '../store/settings-context'
import { ASSET_COLOR } from '../design/tokens'

const CLASS_ORDER: AssetClass[] = ['precious', 'industrial', 'crypto']

/**
 * Global "asset in focus" control. A menu button (not a select) so options can
 * carry the asset's colour and class grouping. Keyboard: Enter/Space/↓ opens,
 * ↑/↓ move, Home/End jump, Enter selects, Escape closes and returns focus.
 */
export function AssetPicker() {
  const { asset, setAsset } = useSettings()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  // Flattened, class-ordered options (group headings are not focusable).
  const groups = CLASS_ORDER.map((cls) => ({ cls, ids: ASSETS.filter((a) => UNIVERSE[a].assetClass === cls) })).filter((g) => g.ids.length)
  const options: AssetId[] = groups.flatMap((g) => g.ids)

  useEffect(() => {
    if (!open) return
    listRef.current?.focus()
    const onDown = (e: MouseEvent) => {
      if (!listRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const openMenu = () => {
    setActive(Math.max(0, options.indexOf(asset)))
    setOpen(true)
  }
  const choose = (id: AssetId) => {
    setAsset(id)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onListKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((i) => (i + 1) % options.length)
    else if (e.key === 'ArrowUp') setActive((i) => (i - 1 + options.length) % options.length)
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(options.length - 1)
    else if (e.key === 'Enter' || e.key === ' ') choose(options[active])
    else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false)
      if (e.key === 'Escape') buttonRef.current?.focus()
      return
    } else return
    e.preventDefault()
  }

  const spec = UNIVERSE[asset]
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Asset in focus: ${spec.label}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openMenu()
          }
        }}
        className="flex h-7 items-center gap-2 pointer-coarse:h-10 rounded-md border border-border bg-surface-2 pl-2 pr-1.5 text-xs font-medium text-foreground transition-colors hover:border-border-strong"
      >
        <span aria-hidden className="size-2 rounded-full" style={{ background: ASSET_COLOR[asset] }} />
        {spec.label}
        <RiArrowDownSLine size={14} className={clsx('text-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          ref={listRef}
          id={menuId}
          role="listbox"
          tabIndex={-1}
          aria-label="Asset in focus"
          aria-activedescendant={`${menuId}-${options[active]}`}
          onKeyDown={onListKey}
          className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-md border border-border bg-surface-3 py-1 shadow-lg outline-none"
        >
          {groups.map((g) => (
            <div key={g.cls} role="group" aria-label={ASSET_CLASS_LABEL[g.cls]}>
              <div className="label px-3 pb-1 pt-2 text-faint">{ASSET_CLASS_LABEL[g.cls]}</div>
              {g.ids.map((id) => {
                const i = options.indexOf(id)
                const s = UNIVERSE[id]
                return (
                  <div
                    key={id}
                    id={`${menuId}-${id}`}
                    role="option"
                    aria-selected={id === asset}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(id)}
                    className={clsx('flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px]', i === active ? 'bg-surface-2 text-foreground' : 'text-muted')}
                  >
                    <span aria-hidden className="size-2 rounded-full" style={{ background: ASSET_COLOR[id] }} />
                    <span className="flex-1">{s.label}</span>
                    <span className="num text-2xs text-faint">{s.unitLabel}</span>
                    {id === asset && <RiCheckLine size={14} className="text-brand" />}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
