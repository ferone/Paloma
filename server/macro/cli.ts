import 'dotenv/config'
import { getDb } from '../db/client.js'
import { publishMacroArtifact, refreshCot, refreshFred } from './service.js'

// npm run macro:refresh [-- fred|cot]  — run the macro refresh from the CLI.
const what = process.argv[2] ?? 'all'
const ctx = { progress: () => {}, log: (m: string) => console.log(`  ${m}`) }

async function main() {
  getDb()
  if (what === 'all' || what === 'fred') console.log(await refreshFred(ctx))
  if (what === 'all' || what === 'cot') console.log(await refreshCot(ctx))
  const lite = publishMacroArtifact()
  console.log(`Published macro:dashboard — ${lite.regime}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
