// Golden-output regression harness for refactors that must not change results.
//
//   node scripts/golden.mjs snapshot        freeze data/gold.db + data/demo.db into data/golden/*.db
//   node scripts/golden.mjs capture <label> recompute on fresh copies (OFFLINE=1) and save API outputs
//   node scripts/golden.mjs compare <a> <b> diff two captures (volatile fields ignored)
//
// Everything lives under data/golden (gitignored). Yahoo is disabled during
// capture so live price moves cannot show up as differences.
import Database from 'better-sqlite3'
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const G = join(ROOT, 'data', 'golden')
const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
// GOLDEN_PORT lets parallel checkouts capture without clashing (uses PORT and PORT+1).
const PORT_GOLD = Number(process.env.GOLDEN_PORT || 3401)
const PORT_DEMO = PORT_GOLD + 1

const [cmd, a, b] = process.argv.slice(2)

async function snapshot() {
  mkdirSync(G, { recursive: true })
  for (const name of ['gold', 'demo']) {
    const src = new Database(join(ROOT, 'data', `${name}.db`), { readonly: true })
    await src.backup(join(G, `${name}.db`))
    src.close()
    console.log(`frozen data/${name}.db -> data/golden/${name}.db`)
  }
}

function freshCopies(label) {
  const dir = join(G, `run-${label}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const name of ['gold', 'demo']) copyFileSync(join(G, `${name}.db`), join(dir, `${name}.db`))
  return dir
}

function runCli(script, dbPath, args = []) {
  const r = spawnSync(process.execPath, [TSX, script, ...args], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH: dbPath, OFFLINE: '1' },
    encoding: 'utf8',
  })
  if (r.status !== 0) throw new Error(`${script} failed:\n${r.stdout}\n${r.stderr}`)
  return r.stdout
}

async function startServer(dbPath, port) {
  const child = spawn(process.execPath, [TSX, 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH: dbPath, OFFLINE: '1', PORT: String(port), QUANT_AUTO_RECOMPUTE: '0' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/api/health`)
      if (r.ok) return child
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  child.kill()
  throw new Error(`server on ${port} did not start`)
}

async function grab(port, path) {
  const r = await fetch(`http://localhost:${port}${path}`)
  return { status: r.status, body: await r.json().catch(() => null) }
}

const GOLD_ENDPOINTS = [
  '/api/quant/opportunities?metal=gold&mode=conservative',
  '/api/quant/opportunities?metal=silver&mode=conservative',
  '/api/quant/opportunities?metal=gold&mode=aggressive',
  '/api/quant/relative-value?pair=gold-silver',
  '/api/quant/backtest?metal=gold&mode=conservative',
  '/api/quant/instrument/GC.fly.0-1-2',
  '/api/quant/seasonality/SI.seas.H-K',
  '/api/macro/dashboard?metal=gold',
  '/api/macro/dashboard?metal=silver',
  '/api/macro/correlations?metal=gold&window=63',
  '/api/marketdata/contracts?root=GC',
]
const DEMO_ENDPOINTS = [
  '/api/portfolio/summary',
  '/api/portfolio/holdings',
  '/api/portfolio/performance?benchmark=GLD',
  '/api/portfolio/risk',
  '/api/portfolio/attribution',
  '/api/portfolio/vault',
]

async function capture(label) {
  const dir = freshCopies(label)
  const out = join(G, label)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  console.log(runCli('server/quant/cli.ts', join(dir, 'gold.db')).trim())
  for (const metal of ['gold', 'silver']) {
    runCli('server/ml/cli.ts', join(dir, 'gold.db'), ['export', metal])
  }
  const mlDir = join(ROOT, 'data', 'ml')
  for (const f of readdirSync(mlDir).filter((f) => /^features_.*\.csv$/.test(f))) copyFileSync(join(mlDir, f), join(out, f))

  const gold = await startServer(join(dir, 'gold.db'), PORT_GOLD)
  const demo = await startServer(join(dir, 'demo.db'), PORT_DEMO)
  try {
    for (const [port, list] of [
      [PORT_GOLD, GOLD_ENDPOINTS],
      [PORT_DEMO, DEMO_ENDPOINTS],
    ]) {
      for (const p of list) {
        const file = p.replace(/^\/api\//, '').replace(/[^a-z0-9.-]+/gi, '_') + '.json'
        writeFileSync(join(out, file), JSON.stringify(await grab(port, p), null, 1))
      }
    }
  } finally {
    gold.kill()
    demo.kill()
  }
  console.log(`captured ${readdirSync(out).length} files -> data/golden/${label}`)
}

// Fields that legitimately differ between runs (clock time, run ids).
const VOLATILE = new Set(['generatedAt', 'timestamp', 'computedAt', 'startedAt', 'finishedAt', 'durationMs', 'runId', 'id', 'createdAt', 'ageDays'])
// Renames the refactor is allowed to make: old key -> new key.
const RENAMES = {
  ounces: 'exposureUnits',
  ozPerContract: 'pointValue',
  metal: 'asset',
  netExposureOz: 'netExposure',
  exposureByMetal: 'exposureByAsset',
  byMetal: 'byAsset',
  fineOz: 'fineQty',
  ledgerOz: 'ledgerQty',
}
// With --allow-additions, keys present only in the newer capture are accepted
// (new fields); any changed or removed value still counts as a difference.
const allowAdditions = process.argv.includes('--allow-additions')

function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize)
  if (v && typeof v === 'object') {
    const o = {}
    for (const [k, x] of Object.entries(v)) {
      if (VOLATILE.has(k)) continue
      o[RENAMES[k] ?? k] = normalize(x)
    }
    return o
  }
  if (typeof v === 'number') return Math.round(v * 1e9) / 1e9
  // Wall-clock timestamps (with a time component) are volatile; plain data dates are not.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(v)) return '<timestamp>'
  return v
}

function diffs(x, y, path = '', out = []) {
  if (out.length > 25) return out
  if (allowAdditions && x === undefined && y !== undefined) return out
  if (typeof x !== typeof y || Array.isArray(x) !== Array.isArray(y)) {
    out.push(`${path}: ${JSON.stringify(x)?.slice(0, 80)} != ${JSON.stringify(y)?.slice(0, 80)}`)
  } else if (x && typeof x === 'object') {
    const keys = new Set([...Object.keys(x), ...Object.keys(y)])
    for (const k of keys) diffs(x[k], y[k], `${path}.${k}`, out)
  } else if (x !== y) {
    out.push(`${path}: ${JSON.stringify(x)?.slice(0, 80)} != ${JSON.stringify(y)?.slice(0, 80)}`)
  }
  return out
}

function compare(la, lb) {
  let bad = 0
  for (const f of readdirSync(join(G, la))) {
    const pa = join(G, la, f)
    const pb = join(G, lb, f)
    if (!existsSync(pb)) {
      console.log(`MISSING in ${lb}: ${f}`)
      bad++
      continue
    }
    if (f.endsWith('.csv')) {
      const same = readFileSync(pa, 'utf8') === readFileSync(pb, 'utf8')
      console.log(`${same ? 'same' : 'DIFF'}  ${f}`)
      if (!same) bad++
      continue
    }
    const d = diffs(normalize(JSON.parse(readFileSync(pa, 'utf8'))), normalize(JSON.parse(readFileSync(pb, 'utf8'))))
    console.log(`${d.length ? 'DIFF' : 'same'}  ${f}`)
    if (d.length) {
      bad++
      for (const line of d) console.log(`      ${line}`)
    }
  }
  console.log(bad ? `\n${bad} file(s) differ` : '\nall outputs identical')
  process.exitCode = bad ? 1 : 0
}

if (cmd === 'snapshot') await snapshot()
else if (cmd === 'capture' && a) await capture(a)
else if (cmd === 'compare' && a && b) compare(a, b)
else console.log('usage: node scripts/golden.mjs snapshot | capture <label> | compare <a> <b>')
