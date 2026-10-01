import 'dotenv/config'
import type { IntegrationStatus, KeySource } from '../../shared/api.js'
import { dbPath, getDb, isDbReady } from '../db/client.js'
import { secretValue, type SecretName } from './secrets.js'

// Central, typed access to configuration. API keys resolve per read in the
// order: key saved in Settings (encrypted in the DB) → .env → empty, so a key
// changed in Settings takes effect on the next request without a restart.
// Secrets are only ever exposed to the client masked (see server/settings).

function secret(name: SecretName): string {
  return secretValue(name) || process.env[name] || ''
}

export function keySource(name: SecretName): KeySource {
  if (secretValue(name)) return 'settings'
  return process.env[name] ? 'env' : 'none'
}

function numberSetting(key: string, fallback: number): number {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    const n = row ? Number(JSON.parse(row.value)) : NaN
    return Number.isFinite(n) && n >= 0 ? n : fallback
  } catch {
    return fallback
  }
}

export const env = {
  port: Number(process.env.PORT || 3001),
  /** Interface the API listens on. Local-only by default; set HOST=0.0.0.0 to expose it deliberately. */
  host: process.env.HOST || '127.0.0.1',
  get databentoKey() {
    return secret('DATABENTO_API_KEY')
  },
  get openrouterKey() {
    return secret('OPENROUTER_API_KEY')
  },
  openrouterModel: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.6',
  get fredKey() {
    return secret('FRED_API_KEY')
  },
  /** Optional CFTC Socrata app token (raises COT rate limits). */
  get cftcAppToken() {
    return secret('CFTC_APP_TOKEN')
  },
  /** Max USD a single Databento pull may cost without an explicit override (Settings → databento.budget). */
  get databentoBudget() {
    return numberSetting('databento.budget', Number(process.env.DATABENTO_BUDGET || 1))
  },
}

export function integrationStatus(): IntegrationStatus {
  return {
    databento: !!env.databentoKey,
    openrouter: !!env.openrouterKey,
    fred: !!env.fredKey,
    cftc: !!env.cftcAppToken,
    openrouterModel: env.openrouterKey ? env.openrouterModel : null,
    dbPath: dbPath(),
    dbReady: isDbReady(),
  }
}
