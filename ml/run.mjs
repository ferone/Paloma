#!/usr/bin/env node
/**
 * Portability shim for the ML pipeline (plain node, no deps). Resolves the
 * interpreter, then runs pipeline.py (or `--script <file>`) forwarding argv and
 * the exit code:
 *
 *   1. env `ML_PYTHON` if set (absolute path or a command on PATH, used as-is)
 *   2. ml/.venv/Scripts/python.exe   (Windows venv)
 *   3. ml/.venv/bin/python           (POSIX venv)
 *   4. `python3`, then `python` on PATH, preferring one that can import
 *      sklearn/pandas/joblib (else the first that runs at all)
 *
 * The server uses the same order (server/ml/python.ts).
 *   node ml/run.mjs train --metal gold
 *   node ml/run.mjs --script -m pytest ml -q
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function resolvePython() {
  if (process.env.ML_PYTHON) return process.env.ML_PYTHON
  for (const p of [join(here, '.venv', 'Scripts', 'python.exe'), join(here, '.venv', 'bin', 'python')]) {
    if (existsSync(p)) return p
  }
  // Prefer an interpreter that can import the pipeline deps; else the first that runs.
  let runnable = null
  for (const cmd of ['python3', 'python']) {
    try {
      if (spawnSync(cmd, ['-c', 'import sklearn, pandas, joblib'], { stdio: 'pipe', windowsHide: true }).status === 0) return cmd
      if (!runnable && spawnSync(cmd, ['--version'], { stdio: 'pipe', windowsHide: true }).status === 0) runnable = cmd
    } catch {
      // try the next candidate
    }
  }
  return runnable
}

const python = resolvePython()
if (!python) {
  console.error(
    'run.mjs: no python interpreter found.\n' +
      '  Set ML_PYTHON, or create the venv:\n' +
      '  python -m venv ml/.venv && <venv python> -m pip install -r ml/requirements.txt',
  )
  process.exit(1)
}

const argv = process.argv.slice(2)
const args = argv[0] === '--script' ? argv.slice(1) : [join(here, 'pipeline.py'), ...argv]
const result = spawnSync(python, args, { stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
if (result.error) {
  console.error(`run.mjs: failed to launch "${python}": ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
