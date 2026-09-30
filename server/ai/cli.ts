import 'dotenv/config'
import { getDb } from '../db/client.js'
import { env } from '../lib/env.js'
import { parseRequest, startReport } from './service.js'

// npm run ai:report -- <kind> [gold|silver] ["question for ask"]
//   e.g. npm run ai:report -- macro_brief gold
//        npm run ai:report -- ask silver "What is driving the gold/silver ratio?"
async function main() {
  const [kind = 'macro_brief', metal = 'gold', question] = process.argv.slice(2)
  getDb()
  if (!env.openrouterKey) {
    console.log('OPENROUTER_API_KEY not set — the AI analyst is not configured.')
    return
  }
  const req = parseRequest({ kind, metal, input: question ? { question } : undefined })
  const { id, done } = startReport(req)
  console.log(`Report #${id} (${kind}, ${metal}) running…`)
  const r = await done
  console.log(`#${r.id} ${r.status}${r.error ? `: ${r.error}` : ''}`)
  console.log(`model ${r.model} · tokens ${r.tokens ?? 'n/a'} · cost ${r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : 'n/a'}`)
  console.log(`sources kept ${r.sources.length} · dropped ${r.droppedSources} · unsourced claims ${r.unsourcedCount}`)
  if (r.body) console.log(JSON.stringify(r.body, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
