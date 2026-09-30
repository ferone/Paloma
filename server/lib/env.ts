import 'dotenv/config'
import type { IntegrationStatus } from '../../shared/api.js'
import { dbPath, isDbReady } from '../db/client.js'

// Central, typed access to configuration. Secrets are only ever exposed to the
// client as booleans (see integrationStatus).
export const env = {
  port: Number(process.env.PORT || 3001),
  databentoKey: process.env.DATABENTO_API_KEY || '',
  openrouterKey: process.env.OPENROUTER_API_KEY || '',
  openrouterModel: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.6',
  fredKey: process.env.FRED_API_KEY || '',
  /** Max USD a single Databento pull may cost without an explicit override. */
  databentoBudget: Number(process.env.DATABENTO_BUDGET || 10),
}

export function integrationStatus(): IntegrationStatus {
  return {
    databento: !!env.databentoKey,
    openrouter: !!env.openrouterKey,
    fred: !!env.fredKey,
    openrouterModel: env.openrouterKey ? env.openrouterModel : null,
    dbPath: dbPath(),
    dbReady: isDbReady(),
  }
}
