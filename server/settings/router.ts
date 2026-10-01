import { Router } from 'express'
import { z } from 'zod'
import type { GeneralSettings, SecretsResponse, SecretView } from '../../shared/settings.js'
import { setSetting } from '../db/repo.js'
import { adminStatus, lock, requireAdmin, setPin, tokenOf, unlock } from '../lib/admin.js'
import { env, keySource } from '../lib/env.js'
import { SECRET_NAMES, deleteSecret, getStoredSecret, isSecretName, keyPath, setSecret, type SecretName } from '../lib/secrets.js'
import { testSecret } from './probes.js'

// Settings → API keys and the admin PIN. Key values only ever travel browser →
// server; responses carry the masked last four characters at most.

export const router = Router()

const META: Record<SecretName, Omit<SecretView, 'name' | 'configured' | 'source' | 'masked' | 'updatedAt' | 'unreadable'>> = {
  DATABENTO_API_KEY: {
    label: 'Databento',
    purpose: 'Historical CME futures (every contract month) for spreads, butterflies, seasonality and open interest.',
    docsUrl: 'https://databento.com/portal/keys',
    required: true,
  },
  OPENROUTER_API_KEY: {
    label: 'OpenRouter',
    purpose: 'AI analyst briefs and the on-page assistant.',
    docsUrl: 'https://openrouter.ai/settings/keys',
    required: true,
  },
  FRED_API_KEY: {
    label: 'FRED',
    purpose: 'Macro series (real yields, breakevens, dollar, CPI, M2). Optional: a keyless CSV fallback is used without it.',
    docsUrl: 'https://fred.stlouisfed.org/docs/api/api_key.html',
    required: false,
  },
  CFTC_APP_TOKEN: {
    label: 'CFTC (Socrata)',
    purpose: 'Commitments of Traders positioning. Optional: raises the public rate limit.',
    docsUrl: 'https://publicreporting.cftc.gov/profile/edit/developer_settings',
    required: false,
  },
}

function currentValue(name: SecretName): string {
  switch (name) {
    case 'DATABENTO_API_KEY':
      return env.databentoKey
    case 'OPENROUTER_API_KEY':
      return env.openrouterKey
    case 'FRED_API_KEY':
      return env.fredKey
    case 'CFTC_APP_TOKEN':
      return env.cftcAppToken
  }
}

export function secretView(name: SecretName): SecretView {
  const stored = getStoredSecret(name)
  const source = keySource(name)
  const value = currentValue(name)
  return {
    name,
    ...META[name],
    configured: !!value,
    source,
    masked: value ? `••••${value.slice(-4)}` : null,
    updatedAt: source === 'settings' ? (stored?.updatedAt ?? null) : null,
    unreadable: !!stored && stored.value === null,
  }
}

const nameParam = (raw: unknown): SecretName | null => {
  const s = String(raw ?? '')
  return isSecretName(s) ? s : null
}

router.get('/secrets', (_req, res) => {
  res.json({ secrets: SECRET_NAMES.map(secretView), keyFile: keyPath() } satisfies SecretsResponse)
})

const valueSchema = z.object({ value: z.string().trim().min(8, 'That key looks too short').max(512) })

router.put('/secrets/:name', requireAdmin, (req, res) => {
  const name = nameParam(req.params.name)
  if (!name) return void res.status(404).json({ error: 'unknown_key' })
  const parsed = valueSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: 'invalid', message: parsed.error.issues[0].message })
  setSecret(name, parsed.data.value)
  res.json(secretView(name))
})

router.delete('/secrets/:name', requireAdmin, (req, res) => {
  const name = nameParam(req.params.name)
  if (!name) return void res.status(404).json({ error: 'unknown_key' })
  deleteSecret(name)
  res.json(secretView(name))
})

// Testing a candidate value sends it to the provider, so it is admin-only;
// testing the stored key is harmless and open.
router.post('/secrets/:name/test', async (req, res, next) => {
  const name = nameParam(req.params.name)
  if (!name) return void res.status(404).json({ error: 'unknown_key' })
  const candidate = typeof req.body?.value === 'string' ? req.body.value.trim() : ''
  if (candidate) {
    let allowed = false
    requireAdmin(req, res, () => (allowed = true))
    if (!allowed) return
  }
  try {
    res.json(await testSecret(name, candidate || currentValue(name)))
  } catch (e) {
    next(e)
  }
})

// --- General (non-secret) settings -----------------------------------------------

router.get('/general', (_req, res) => {
  res.json({ databentoBudget: env.databentoBudget } satisfies GeneralSettings)
})

const generalSchema = z.object({ databentoBudget: z.number().min(0).max(1000).optional() })

router.put('/general', requireAdmin, (req, res) => {
  const parsed = generalSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: 'invalid', message: parsed.error.issues[0].message })
  if (parsed.data.databentoBudget !== undefined) setSetting('databento.budget', parsed.data.databentoBudget)
  res.json({ databentoBudget: env.databentoBudget } satisfies GeneralSettings)
})

// --- Admin PIN ---------------------------------------------------------------------

export const adminRouter = Router()

adminRouter.get('/status', (req, res) => {
  res.json(adminStatus(req))
})

adminRouter.post('/pin', (req, res) => {
  const r = setPin(req.body?.pin, req.body?.currentPin)
  if (!r.ok) return void res.status(r.status).json({ error: r.error, message: r.message })
  res.json({ token: r.token, expiresInSec: 1800 })
})

adminRouter.post('/unlock', (req, res) => {
  const r = unlock(req.body?.pin)
  if (!r.ok) return void res.status(r.status).json({ error: r.error, message: r.message })
  res.json({ token: r.token, expiresInSec: 1800 })
})

adminRouter.post('/lock', (req, res) => {
  lock(tokenOf(req))
  res.json({ ok: true })
})
