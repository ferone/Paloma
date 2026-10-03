import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { dbPath, getDb } from '../db/client.js'
import { sqliteToIso } from '../db/repo.js'

// API keys editable from Settings. Values are encrypted with AES-256-GCM using
// a machine-local key file, so the DB can be backed up or copied without
// exposing them. Reads are cached in memory; every write clears the cache.

export const SECRET_NAMES = ['DATABENTO_API_KEY', 'OPENROUTER_API_KEY', 'FRED_API_KEY', 'CFTC_APP_TOKEN'] as const
export type SecretName = (typeof SECRET_NAMES)[number]

export const isSecretName = (s: string): s is SecretName => (SECRET_NAMES as readonly string[]).includes(s)

interface Row {
  name: string
  iv: string
  tag: string
  ciphertext: string
  last4: string
  updated_at: string
}

export interface StoredSecret {
  value: string | null // null when the row exists but cannot be decrypted (key file replaced)
  last4: string
  updatedAt: string
}

let keyOverride: Buffer | null = null
let cachedKey: Buffer | null = null
let cache: Map<string, StoredSecret> | null = null
let cachedAt = 0
/** Re-read after this long, so a key saved by another process (CLI, second server) is picked up without a restart. */
const CACHE_MS = 5_000

/** Where the encryption key lives: SECRET_KEY_PATH, else next to the DB. */
export function keyPath(): string {
  return resolve(process.env.SECRET_KEY_PATH || resolve(dirname(dbPath()), 'secret.key'))
}

function loadKey(create: boolean): Buffer | null {
  if (keyOverride) return keyOverride
  if (cachedKey) return cachedKey
  const file = keyPath()
  if (existsSync(file)) {
    const buf = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64')
    if (buf.length !== 32) throw new Error(`${file} is not a valid 32-byte key`)
    return (cachedKey = buf)
  }
  if (!create) return null
  mkdirSync(dirname(file), { recursive: true })
  const key = randomBytes(32)
  writeFileSync(file, key.toString('base64'), { mode: 0o600 })
  try {
    chmodSync(file, 0o600)
  } catch {
    // Windows ignores POSIX modes; the file still lives in the gitignored data dir.
  }
  return (cachedKey = key)
}

export function encrypt(plain: string, key: Buffer): { iv: string; tag: string; ciphertext: string } {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ct.toString('base64') }
}

/** Throws when the key is wrong or the ciphertext was tampered with. */
export function decrypt(box: { iv: string; tag: string; ciphertext: string }, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(box.ciphertext, 'base64')), decipher.final()]).toString('utf8')
}

function loadAll(): Map<string, StoredSecret> {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache
  const out = new Map<string, StoredSecret>()
  let rows: Row[] = []
  try {
    rows = getDb().prepare('SELECT * FROM secrets').all() as Row[]
  } catch {
    // DB not ready (or pre-migration): behave as if nothing is stored.
    return out
  }
  const key = rows.length ? loadKey(false) : null
  for (const r of rows) {
    let value: string | null = null
    if (key) {
      try {
        value = decrypt(r, key)
      } catch {
        value = null
      }
    }
    out.set(r.name, { value, last4: r.last4, updatedAt: sqliteToIso(r.updated_at) })
  }
  cachedAt = Date.now()
  return (cache = out)
}

export function getStoredSecret(name: SecretName): StoredSecret | null {
  return loadAll().get(name) ?? null
}

/** The decrypted value, or undefined when nothing usable is stored. */
export function secretValue(name: SecretName): string | undefined {
  return getStoredSecret(name)?.value || undefined
}

export function setSecret(name: SecretName, value: string): void {
  const v = value.trim()
  if (!v) throw new Error('value must not be empty')
  const box = encrypt(v, loadKey(true)!)
  getDb()
    .prepare(
      `INSERT INTO secrets (name, iv, tag, ciphertext, last4, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(name) DO UPDATE SET iv = excluded.iv, tag = excluded.tag, ciphertext = excluded.ciphertext,
         last4 = excluded.last4, updated_at = excluded.updated_at`,
    )
    .run(name, box.iv, box.tag, box.ciphertext, v.slice(-4))
  cache = null
}

export function deleteSecret(name: SecretName): boolean {
  const r = getDb().prepare('DELETE FROM secrets WHERE name = ?').run(name)
  cache = null
  return r.changes > 0
}

/** Test hook: use a fixed key instead of the key file, and drop caches. */
export function __setKeyForTests(key: Buffer | null): void {
  keyOverride = key
  cachedKey = null
  cache = null
}
