// Production launcher: `npm start` (or double-click "Start Real Assets Dashboard.cmd").
// Builds the dashboard when the build is missing or older than the source, then runs
// one local server that serves both the API and the dashboard at http://localhost:3100,
// and opens the browser. Options: --no-open (don't open a browser), --rebuild (force a build).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PORT = process.env.PORT || '3100'
const URL = `http://localhost:${PORT}`
const args = new Set(process.argv.slice(2))
const shell = process.platform === 'win32'

function newestMtime(dir) {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs)
  }
  return newest
}

const built = resolve('dist/index.html')
const stale = !existsSync(built) || ['src', 'shared'].some((d) => newestMtime(resolve(d)) > statSync(built).mtimeMs)
if (args.has('--rebuild') || stale) {
  console.log('Building the dashboard (first start or source changed)…')
  const b = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell })
  if (b.status !== 0) {
    console.error('Build failed — see the errors above.')
    process.exit(b.status ?? 1)
  }
}

const env = { ...process.env, NODE_ENV: 'production', SERVE_CLIENT: '1', PORT }
const server = spawn('npx', ['tsx', 'server/index.ts'], { stdio: 'inherit', env, shell })
const stop = () => server.kill()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
server.on('exit', (code) => process.exit(code ?? 0))

if (!args.has('--no-open')) {
  // Open the browser once the server answers.
  const started = Date.now()
  const tick = async () => {
    try {
      const r = await fetch(`${URL}/api/health`)
      if (r.ok) {
        console.log(`Real Assets Dashboard is running at ${URL}`)
        const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', URL]] : process.platform === 'darwin' ? ['open', [URL]] : ['xdg-open', [URL]]
        spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref()
        return
      }
    } catch {
      // not up yet
    }
    if (Date.now() - started < 60_000) setTimeout(tick, 1000)
  }
  setTimeout(tick, 1500)
}
