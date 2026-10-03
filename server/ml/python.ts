import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ML_DEVICE_MODES, type MlDeviceMode, type MlPythonStatus } from '../../shared/ml.js'
import { getSetting } from '../db/repo.js'

// Locates the Python interpreter (same order as ml/run.mjs) and runs
// ml/pipeline.py, streaming its `PROGRESS <f> <msg>` lines.

const ML_DIR = resolve('ml')
const PIPELINE = join(ML_DIR, 'pipeline.py')

const isMode = (v: unknown): v is MlDeviceMode => typeof v === 'string' && (ML_DEVICE_MODES as readonly string[]).includes(v)

/**
 * Device mode passed to the pipeline as ML_DEVICE: the `ml.device` setting when
 * saved, else the ML_DEVICE environment variable, else 'auto' (the pipeline
 * benchmarks both devices per family and falls back to the CPU without CUDA).
 */
export function mlDeviceMode(): MlDeviceMode {
  let saved: unknown = null
  try {
    saved = getSetting<unknown>('ml.device', null)
  } catch {
    // no database (e.g. a bare CLI call): fall through to the environment
  }
  if (isMode(saved)) return saved
  const env = process.env.ML_DEVICE?.trim().toLowerCase()
  return isMode(env) ? env : 'auto'
}

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
  for (const cmd of process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']) {
    try {
      if (spawnSync(cmd, ['-c', 'import sklearn, pandas, joblib, xgboost, torch'], { stdio: 'pipe', windowsHide: true }).status === 0) {
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
        const v = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '{}') as {
          python?: string
          sklearn?: string
          xgboost?: string | null
          torch?: string | null
          cuda?: boolean
          gpu?: string | null
        }
        value = {
          available: true,
          interpreter,
          pythonVersion: v.python ?? null,
          sklearnVersion: v.sklearn ?? null,
          xgboostVersion: v.xgboost ?? null,
          torchVersion: v.torch ?? null,
          cuda: v.cuda ?? false,
          gpu: v.gpu ?? null,
          error: null,
        }
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
  return { ...value, deviceMode: mlDeviceMode() }
}

function pyEnv(device?: MlDeviceMode): NodeJS.ProcessEnv {
  return { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...(device ? { ML_DEVICE: device } : {}) }
}

/**
 * Run `pipeline.py <args>`; resolves with the RESULT path. Rejects with the
 * tail of stderr when the process fails. `device` becomes ML_DEVICE for the
 * child (default: `mlDeviceMode()`).
 */
export function runPipeline(
  args: string[],
  onProgress: (fraction: number, message: string) => void = () => {},
  opts: { device?: MlDeviceMode } = {},
): Promise<string> {
  const python = resolvePython()
  if (!python) return Promise.reject(new Error('No Python interpreter found (set ML_PYTHON or create ml/.venv)'))
  return new Promise((resolvePromise, reject) => {
    const child = spawn(python, [PIPELINE, ...args], { env: pyEnv(opts.device ?? mlDeviceMode()), windowsHide: true })
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
