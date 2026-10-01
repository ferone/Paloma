import { useEffect, useRef, useState, type FormEvent } from 'react'
import { RiLockLine } from 'react-icons/ri'
import { isAxiosError } from 'axios'
import type { AdminUnlockResponse } from '@shared/settings'
import { api } from '../api/client'
import { setAdminToken, setPinPrompter } from '../api/admin'
import { Button, Field, Input } from '../ui'

interface Ask {
  pinSet: boolean
  message?: string
  resolve: (token: string | null) => void
}

/**
 * PIN dialog shown whenever a configuration write needs the admin PIN. First
 * run sets the PIN (entered twice); afterwards it unlocks for 30 idle minutes.
 */
export function AdminGate() {
  const [ask, setAsk] = useState<Ask | null>(null)

  useEffect(() => {
    setPinPrompter((pinSet, message) => new Promise((resolve) => setAsk({ pinSet, message, resolve })))
    return () => setPinPrompter(null)
  }, [])

  if (!ask) return null
  const finish = (token: string | null) => {
    if (token) setAdminToken(token)
    ask.resolve(token)
    setAsk(null)
  }
  return <PinDialog key={String(ask.pinSet)} pinSet={ask.pinSet} onDone={finish} />
}

function PinDialog({ pinSet, onDone }: { pinSet: boolean; onDone: (token: string | null) => void }) {
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLInputElement>(null)
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  })

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        doneRef.current(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!pinSet && pin !== confirm) return setError('The two PINs do not match')
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<AdminUnlockResponse>(pinSet ? '/admin/unlock' : '/admin/pin', { pin })
      onDone(r.data.token)
    } catch (err) {
      setError(isAxiosError(err) ? (err.response?.data?.message ?? err.message) : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => onDone(null)} aria-hidden />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-gate-title"
        onSubmit={submit}
        className="relative w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center gap-2 text-muted">
          <RiLockLine size={16} aria-hidden />
          <span className="label">Administrator</span>
        </div>
        <h2 id="admin-gate-title" className="display mb-2 text-xl text-foreground">
          {pinSet ? 'Enter the admin PIN' : 'Create an admin PIN'}
        </h2>
        <p className="mb-5 text-sm leading-relaxed text-muted">
          {pinSet
            ? 'Changing keys, models, budgets and fund settings needs the PIN. You stay unlocked for 30 minutes of activity.'
            : 'Choose a PIN that protects API keys and settings on this machine. It is stored only as a salted hash; there is no recovery, so keep it with the fund’s credentials.'}
        </p>
        <div className="space-y-3">
          <Field label="PIN">
            <Input ref={first} type="password" autoComplete={pinSet ? 'current-password' : 'new-password'} value={pin} onChange={(e) => setPin(e.target.value)} minLength={4} required />
          </Field>
          {!pinSet && (
            <Field label="Repeat PIN" hint="4 or more characters, no spaces.">
              <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={4} required />
            </Field>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-neg-text">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onDone(null)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy || pin.length < 4}>
            {pinSet ? 'Unlock' : 'Set PIN'}
          </Button>
        </div>
      </form>
    </div>
  )
}
