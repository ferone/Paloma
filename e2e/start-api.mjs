// Starts the API for the end-to-end suite against a throwaway database:
// data/e2e.db is recreated and seeded with the demo ledger on every run, the
// scheduler is off and Yahoo runs offline, so the suite never touches the real
// data/gold.db and never triggers a paid data pull. Seeding fetches free Yahoo
// closes, so the first step needs internet access.
import { spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const db = resolve('data/e2e.db')
for (const f of [db, `${db}-wal`, `${db}-shm`]) rmSync(f, { force: true })

const env = { ...process.env, DB_PATH: db, SCHEDULER: '0', OFFLINE: '1', PORT: process.env.E2E_API_PORT || '3901' }
const shell = process.platform === 'win32'

// The demo seed prices its trades from real Yahoo closes (free), so it runs online;
// the API below then serves those cached closes with Yahoo switched off.
const seedEnv = { ...env }
delete seedEnv.OFFLINE
const seed = spawnSync('npx', ['tsx', 'server/portfolio/seed-demo.ts'], { env: seedEnv, stdio: 'inherit', shell })
if (seed.status !== 0) process.exit(seed.status ?? 1)

const api = spawn('npx', ['tsx', 'server/index.ts'], { env, stdio: 'inherit', shell })
const stop = () => api.kill()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
api.on('exit', (code) => process.exit(code ?? 0))
