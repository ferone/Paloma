import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { useTestDb } from '../db/client.js'
import { __setKeyForTests, decrypt, encrypt, getStoredSecret, setSecret } from '../lib/secrets.js'
import { __resetAdminForTests, isPinSet } from '../lib/admin.js'
import { env, keySource } from '../lib/env.js'
import { mountRoutes } from '../routes/index.js'
import type { SecretsResponse, SecretTestResult } from '../../shared/settings.js'
import { testSecret } from './probes.js'

const KEY = randomBytes(32)
const SAVED_ENV = { ...process.env }

let server: Server
let base = ''

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers['x-admin-token'] = token
  const r = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: (await r.json()) as T, text: '' }
}

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  mountRoutes(app)
  await new Promise<void>((resolve) => (server = app.listen(0, '127.0.0.1', () => resolve())))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.close()
  __setKeyForTests(null)
  process.env = SAVED_ENV
})

beforeEach(() => {
  useTestDb()
  __setKeyForTests(KEY)
  __resetAdminForTests()
  delete process.env.OPENROUTER_API_KEY
  delete process.env.DATABENTO_API_KEY
})

describe('secret encryption', () => {
  it('round-trips and rejects tampering or a wrong key', () => {
    const box = encrypt('sk-or-v1-abcdef', KEY)
    expect(box.ciphertext).not.toContain('abcdef')
    expect(decrypt(box, KEY)).toBe('sk-or-v1-abcdef')
    const flipped = Buffer.from(box.ciphertext, 'base64')
    flipped[0] ^= 1
    expect(() => decrypt({ ...box, ciphertext: flipped.toString('base64') }, KEY)).toThrow()
    expect(() => decrypt(box, randomBytes(32))).toThrow()
  })

  it('resolves keys Settings → .env → empty, live', () => {
    expect(env.openrouterKey).toBe('')
    expect(keySource('OPENROUTER_API_KEY')).toBe('none')
    process.env.OPENROUTER_API_KEY = 'env-key-1234'
    expect(env.openrouterKey).toBe('env-key-1234')
    expect(keySource('OPENROUTER_API_KEY')).toBe('env')
    setSecret('OPENROUTER_API_KEY', 'db-key-5678')
    expect(env.openrouterKey).toBe('db-key-5678')
    expect(keySource('OPENROUTER_API_KEY')).toBe('settings')
  })

  it('treats a key that the machine key cannot decrypt as unreadable, not fatal', () => {
    setSecret('DATABENTO_API_KEY', 'db-secret-value-9999')
    __setKeyForTests(randomBytes(32)) // simulates a lost/replaced data/secret.key
    expect(getStoredSecret('DATABENTO_API_KEY')).toMatchObject({ value: null, last4: '9999' })
    expect(env.databentoKey).toBe('')
  })
})

describe('admin PIN', () => {
  it('requires a PIN for key writes, then accepts the token', async () => {
    const denied = await call('PUT', '/api/settings/secrets/OPENROUTER_API_KEY', { value: 'sk-or-v1-newvalue' })
    expect(denied.status).toBe(401)
    expect(denied.body).toMatchObject({ error: 'admin_required', pinSet: false })

    const set = await call<{ token: string }>('POST', '/api/admin/pin', { pin: '2468' })
    expect(set.status).toBe(200)
    expect(isPinSet()).toBe(true)

    const ok = await call('PUT', '/api/settings/secrets/OPENROUTER_API_KEY', { value: 'sk-or-v1-newvalue' }, set.body.token)
    expect(ok.status).toBe(200)
    expect(env.openrouterKey).toBe('sk-or-v1-newvalue')
  })

  it('guards configuration writes owned by other domains', async () => {
    for (const path of ['/api/ai/settings', '/api/marketdata/schedule', '/api/portfolio/settings', '/api/settings/general']) {
      expect((await call('PUT', path, {})).status, path).toBe(401)
    }
  })

  it('locks out after five wrong PINs', async () => {
    await call('POST', '/api/admin/pin', { pin: '2468' })
    for (let i = 0; i < 5; i++) expect((await call('POST', '/api/admin/unlock', { pin: '0000' })).status).toBe(403)
    expect((await call('POST', '/api/admin/unlock', { pin: '2468' })).status).toBe(429)
  })

  it('the ML device setting needs the PIN and persists', async () => {
    expect((await call('PUT', '/api/settings/general', { mlDevice: 'cpu' })).status).toBe(401)
    const { body } = await call<{ token: string }>('POST', '/api/admin/pin', { pin: '2468' })
    expect((await call('PUT', '/api/settings/general', { mlDevice: 'gpu' }, body.token)).status).toBe(400)
    const ok = await call<{ mlDevice: string }>('PUT', '/api/settings/general', { mlDevice: 'cpu' }, body.token)
    expect(ok.body.mlDevice).toBe('cpu')
    expect((await call<{ mlDevice: string }>('GET', '/api/settings/general')).body.mlDevice).toBe('cpu')
  })

  it('changing the PIN needs the current one', async () => {
    await call('POST', '/api/admin/pin', { pin: '2468' })
    expect((await call('POST', '/api/admin/pin', { pin: '1357' })).status).toBe(403)
    expect((await call('POST', '/api/admin/pin', { pin: '1357', currentPin: '2468' })).status).toBe(200)
    expect((await call('POST', '/api/admin/unlock', { pin: '1357' })).status).toBe(200)
  })
})

describe('GET /api/settings/secrets', () => {
  it('never returns key material beyond the last four characters', async () => {
    setSecret('OPENROUTER_API_KEY', 'sk-or-v1-supersecretvalue-WXYZ')
    process.env.DATABENTO_API_KEY = 'db-envsecretvalue-ABCD'
    const r = await call<SecretsResponse>('GET', '/api/settings/secrets')
    const raw = JSON.stringify(r.body)
    expect(raw).not.toContain('supersecret')
    expect(raw).not.toContain('envsecret')
    const or = r.body.secrets.find((s) => s.name === 'OPENROUTER_API_KEY')!
    expect(or).toMatchObject({ configured: true, source: 'settings', masked: '••••WXYZ' })
    expect(r.body.secrets.find((s) => s.name === 'DATABENTO_API_KEY')).toMatchObject({ source: 'env', masked: '••••ABCD' })
    expect(r.body.secrets.find((s) => s.name === 'FRED_API_KEY')).toMatchObject({ configured: false, source: 'none', masked: null })
  })

  it('DELETE reverts to the .env value', async () => {
    const { body } = await call<{ token: string }>('POST', '/api/admin/pin', { pin: '2468' })
    process.env.OPENROUTER_API_KEY = 'env-key-1234'
    setSecret('OPENROUTER_API_KEY', 'db-key-5678')
    const r = await call('DELETE', '/api/settings/secrets/OPENROUTER_API_KEY', undefined, body.token)
    expect(r.body).toMatchObject({ source: 'env', masked: '••••1234' })
  })

  it('testing a candidate key needs admin; unknown names 404', async () => {
    expect((await call('POST', '/api/settings/secrets/FRED_API_KEY/test', { value: 'candidate-key' })).status).toBe(401)
    expect((await call('POST', '/api/settings/secrets/NOPE/test', {})).status).toBe(404)
  })
})

describe('key probes', () => {
  it('reads OpenRouter credit from the key endpoint', async () => {
    const f = (async () => new Response(JSON.stringify({ data: { limit: 10, usage: 0.4 } }))) as unknown as typeof fetch
    const r: SecretTestResult = await testSecret('OPENROUTER_API_KEY', 'sk-test', f)
    expect(r.ok).toBe(true)
    expect(r.message).toContain('$9.60 of $10.00')
  })

  it('reports a rejected key without throwing', async () => {
    const f = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
    expect(await testSecret('OPENROUTER_API_KEY', 'sk-test', f)).toMatchObject({ ok: false })
    expect(await testSecret('FRED_API_KEY', 'bad', f)).toMatchObject({ ok: false })
  })
})
