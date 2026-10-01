import type { SecretTestResult } from '../../shared/settings.js'
import { UNIVERSE } from '../../shared/universe.js'
import { DatabentoClient } from '../marketdata/databento/client.js'
import { fetchFredSeries } from '../macro/fred.js'
import { fetchCotReports } from '../macro/cot.js'
import type { SecretName } from '../lib/secrets.js'

// One cheap, free request per provider to prove a key works. None of these
// spend credits: Databento's dataset range and OpenRouter's key endpoint are
// metadata calls; FRED and CFTC return a few recent observations.

export const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300)

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

async function testDatabento(key: string, f: typeof fetch): Promise<SecretTestResult> {
  const r = await new DatabentoClient({ apiKey: key, fetchImpl: f, tries: 1, timeoutMs: 20_000 }).getDatasetRange()
  return { ok: true, message: `Connected. GLBX.MDP3 data available to ${r.end.slice(0, 10)}.` }
}

async function testOpenRouter(key: string, f: typeof fetch): Promise<SecretTestResult> {
  const res = await f(OPENROUTER_KEY_URL, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) })
  if (res.status === 401 || res.status === 403) return { ok: false, message: 'OpenRouter rejected this key.' }
  if (!res.ok) return { ok: false, message: `OpenRouter answered HTTP ${res.status}.` }
  const body = (await res.json()) as { data?: { limit?: number | null; usage?: number | null; label?: string } }
  const d = body.data ?? {}
  const limit = typeof d.limit === 'number' ? d.limit : null
  const usage = typeof d.usage === 'number' ? d.usage : null
  const left = limit != null && usage != null ? Math.max(0, limit - usage) : null
  return {
    ok: true,
    message: limit != null ? `Connected. $${(left ?? 0).toFixed(2)} of $${limit.toFixed(2)} credit left.` : 'Connected. No credit limit on this key.',
    detail: { limitUsd: limit, usageUsd: usage, remainingUsd: left },
  }
}

async function testFred(key: string, f: typeof fetch): Promise<SecretTestResult> {
  const r = await fetchFredSeries('DFII10', { apiKey: key, from: isoDaysAgo(20), fetchImpl: f, timeoutMs: 20_000 })
  return { ok: true, message: `Connected. Read ${r.points.length} recent 10y real-yield observations.` }
}

async function testCftc(key: string, f: typeof fetch): Promise<SecretTestResult> {
  const cot = UNIVERSE.gold.cot!
  const rows = await fetchCotReports(cot, { appToken: key, since: isoDaysAgo(30), fetchImpl: f })
  return { ok: true, message: `Connected. Read ${rows.length} recent gold COT report${rows.length === 1 ? '' : 's'}.` }
}

const PROBES: Record<SecretName, (key: string, f: typeof fetch) => Promise<SecretTestResult>> = {
  DATABENTO_API_KEY: testDatabento,
  OPENROUTER_API_KEY: testOpenRouter,
  FRED_API_KEY: testFred,
  CFTC_APP_TOKEN: testCftc,
}

/** Never throws: failures come back as { ok: false, message }. */
export async function testSecret(name: SecretName, key: string, f: typeof fetch = fetch): Promise<SecretTestResult> {
  if (!key) return { ok: false, message: 'No key to test. Enter one, or set it in .env.' }
  try {
    return await PROBES[name](key, f)
  } catch (e) {
    const m = msg(e)
    const auth = /\b(400|401|403)\b|unauthori[sz]ed|forbidden|api key|invalid/i.test(m)
    return { ok: false, message: auth ? `The provider rejected this key (${m})` : `Could not verify: ${m}` }
  }
}
