import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { MlPythonStatus } from '../../shared/ml.js'

// Locates the Python interpreter (same order as ml/run.mjs) and runs
// ml/pipeline.py, streaming its `PROGRESS <f> <msg>` lines.

const ML_DIR = resolve('ml')
const PIPELINE = join(ML_DIR, 'pipeline.py')

let cachedPython: string | null | undefined

export function resolvePython(): string | null {
  if (cachedPython !== undefined) return cachedPython
  const candidates = [
    process.env.ML_PYTHON,
    join(ML_DIR, '.venv', 'Scripts', 'python.exe'),
    join(ML_DIR, '.venv', 'bin', 'python'),
  ].filter((x): x is string => !!x)
  for (const c of candidates) {
    if (c === process.env.ML_PYTHON || existsSync(c)) {
      cachedPython = c
      return c
    }
  }
  // On PATH: prefer an interpreter that can import the pipeline deps (several
  // Pythons often coexist); else the first that runs at all.
  let runnable: string | null = null
  for (const cmd of ['python3', 'python']) {
    try {
      if (spawnSync(cmd, ['-c', 'import sklearn, pandas, joblib'], { stdio: 'pipe', windowsHide: true }).status === 0) {
        cachedPython = cmd
        return cmd
      }
      if (!runnable && spawnSync(cmd, ['--version'], { stdio: 'pipe', windowsHide: true }).status === 0) runnable = cmd
    } catch {
      // try the next candidate
    }
  }
  cachedPython = runnable
  return runnable
}

let statusCache: { at: number; value: MlPythonStatus } | null = null

/** Interpreter + library versions (cached for 10 minutes). */
export function pythonStatus(): MlPythonStatus {
  if (statusCache && Date.now() - statusCache.at < 600_000) return statusCache.value
  const interpreter = resolvePython()
  let value: MlPythonStatus
  if (!interpreter) {
    value = { available: false, interpreter: null, pythonVersion: null, sklearnVersion: null, error: 'No Python interpreter found (set ML_PYTHON or create ml/.venv)' }
  } else {
    const r = spawnSync(interpreter, [PIPELINE, 'version'], { encoding: 'utf8', timeout: 60_000, env: pyEnv() })
    if (r.status === 0) {
      try {
        const v = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '{}') as { python?: string; sklearn?: string }
        value = { available: true, interpreter, pythonVersion: v.python ?? null, sklearnVersion: v.sklearn ?? null, error: null }
      } catch {
        value = { available: false, interpreter, pythonVersion: null, sklearnVersion: null, error: 'Unexpected version output' }
      }
    } else {
      const err = (r.stderr || r.error?.message || '').trim().split('\n').at(-1) ?? 'python failed'
      value = {
        available: false,
        interpreter,
        pythonVersion: null,
        sklearnVersion: null,
        error: `Python found but the pipeline dependencies are missing: ${err} (pip install -r ml/requirements.txt)`,
      }
    }
  }
  statusCache = { at: Date.now(), value }
  return value
}

function pyEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
}

/**
 * Run `pipeline.py <args>`; resolves with the RESULT path. Rejects with the
 * tail of stderr when the process fails.
 */
export function runPipeline(args: string[], onProgress: (fraction: number, message: string) => void = () => {}): Promise<string> {
  const python = resolvePython()
  if (!python) return Promise.reject(new Error('No Python interpreter found (set ML_PYTHON or create ml/.venv)'))
  return new Promise((resolvePromise, reject) => {
    const child = spawn(python, [PIPELINE, ...args], { env: pyEnv(), windowsHide: true })
    let resultPath: string | null = null
    let buf = ''
    const errTail: string[] = []
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        const pm = /^PROGRESS\s+([\d.]+)\s+(.*)$/.exec(line)
        if (pm) onProgress(Number(pm[1]), pm[2])
        const rm = /^RESULT\s+(.+)$/.exec(line)
        if (rm) resultPath = rm[1]
      }
    })
    child.stderr.on('data', (chunk: string) => {
      errTail.push(...chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
      if (errTail.length > 20) errTail.splice(0, errTail.length - 20)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 && resultPath) resolvePromise(resultPath)
      else reject(new Error(`pipeline.py ${args[0]} exited with ${code}: ${errTail.slice(-3).join(' | ') || 'no output'}`))
    })
  })
}
