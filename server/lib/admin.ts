import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { AdminStatus } from '../../shared/settings.js'
import { getSetting, setSetting } from '../db/repo.js'

// Admin PIN guarding configuration edits (API keys, AI model and budget,
// scheduler, fund settings). The server only listens on localhost, so the PIN
// protects against anyone else using this machine, not against the network.
// The PIN is stored as a salted scrypt hash; unlocking returns a session token
// kept in memory (a restart locks everything again).

const PIN_KEY = 'admin.pinHash'
export const TOKEN_IDLE_MS = 30 * 60_000
const MAX_FAILS = 5
const FAIL_WINDOW_MS = 5 * 60_000

interface PinHash {
  salt: string
  hash: string
}

const tokens = new Map<string, number>() // token → last used (ms)
let fails: number[] = []

const now = () => Date.now()

export function validPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\S{4,64}$/.test(pin)
}

function hashPin(pin: string, salt: Buffer): string {
  return scryptSync(pin, salt, 32).toString('base64')
}

export function isPinSet(): boolean {
  return getSetting<PinHash | null>(PIN_KEY, null) !== null
}

function checkPin(pin: string): boolean {
  const stored = getSetting<PinHash | null>(PIN_KEY, null)
  if (!stored) return false
  const a = Buffer.from(hashPin(pin, Buffer.from(stored.salt, 'base64')), 'base64')
  const b = Buffer.from(stored.hash, 'base64')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function lockedForMs(): number {
  fails = fails.filter((t) => now() - t < FAIL_WINDOW_MS)
  return fails.length >= MAX_FAILS ? FAIL_WINDOW_MS - (now() - fails[0]) : 0
}

function issueToken(): string {
  const t = randomBytes(24).toString('base64url')
  tokens.set(t, now())
  return t
}

export function tokenValid(token: string | undefined): boolean {
  if (!token) return false
  const last = tokens.get(token)
  if (last === undefined) return false
  if (now() - last > TOKEN_IDLE_MS) {
    tokens.delete(token)
    return false
  }
  tokens.set(token, now())
  return true
}

export type PinResult = { ok: true; token: string } | { ok: false; status: number; error: string; message: string }

/** First-run setup, or a change that proves knowledge of the current PIN. */
export function setPin(pin: unknown, currentPin?: unknown): PinResult {
  if (!validPin(pin)) return { ok: false, status: 400, error: 'invalid_pin', message: 'PIN must be 4–64 characters with no spaces' }
  if (isPinSet()) {
    const locked = lockedForMs()
    if (locked > 0) return { ok: false, status: 429, error: 'locked', message: `Too many wrong PINs; try again in ${Math.ceil(locked / 1000)}s` }
    if (!validPin(currentPin) || !checkPin(currentPin)) {
      fails.push(now())
      return { ok: false, status: 403, error: 'wrong_pin', message: 'Current PIN is incorrect' }
    }
    tokens.clear() // a new PIN ends every existing session
  }
  const salt = randomBytes(16)
  setSetting(PIN_KEY, { salt: salt.toString('base64'), hash: hashPin(pin, salt) } satisfies PinHash)
  fails = []
  return { ok: true, token: issueToken() }
}

export function unlock(pin: unknown): PinResult {
  if (!isPinSet()) return { ok: false, status: 409, error: 'pin_not_set', message: 'Set an admin PIN first' }
  const locked = lockedForMs()
  if (locked > 0) return { ok: false, status: 429, error: 'locked', message: `Too many wrong PINs; try again in ${Math.ceil(locked / 1000)}s` }
  if (!validPin(pin) || !checkPin(pin)) {
    fails.push(now())
    const left = MAX_FAILS - fails.length
    return { ok: false, status: 403, error: 'wrong_pin', message: left > 0 ? `Wrong PIN (${left} attempt${left === 1 ? '' : 's'} left)` : 'Wrong PIN; locked for 5 minutes' }
  }
  fails = []
  return { ok: true, token: issueToken() }
}

export function lock(token: string | undefined): void {
  if (token) tokens.delete(token)
}

export const tokenOf = (req: Request): string | undefined => req.get('x-admin-token') || undefined

export function adminStatus(req: Request): AdminStatus {
  return { pinSet: isPinSet(), unlocked: tokenValid(tokenOf(req)), lockedForSec: Math.ceil(lockedForMs() / 1000) }
}

/** Express guard for configuration writes. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (tokenValid(tokenOf(req))) return next()
  const pinSet = isPinSet()
  res.status(401).json({
    error: 'admin_required',
    pinSet,
    message: pinSet ? 'Enter the admin PIN to change settings' : 'Set an admin PIN to change settings',
  })
}

/** Test hook. */
export function __resetAdminForTests(): void {
  tokens.clear()
  fails = []
}
