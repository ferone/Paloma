import { DATABENTO_HISTORY_START, DATABENTO_ROOTS, DATABENTO_SCHEMAS, isDatabentoRoot, type DatabentoRoot, type DatabentoSchema } from '../../shared/marketdata.js'
import { env } from '../lib/env.js'
import type { JobContext } from '../jobs/registry.js'
import { estimate } from './databento/cost.js'
import { freshness } from './freshness.js'
import { databentoClient, runBackfill, runIncremental } from './jobs.js'
import { ingestYahoo } from './yahoo.js'

// npm run data:<cmd> -- key=value …   (key=value survives npm on Windows, unlike --flags)
//   data:freshness                         table of dataset coverage
//   data:yahoo                             Yahoo daily history refresh
//   data:estimate  roots=GC,SI start=2010-06-06 [end=] [schemas=ohlcv-1d,statistics]   FREE
//   data:backfill  roots=GC start=… [maxCost=5] confirm=yes                             PAID
//   data:incremental [maxCost=1]                                                        PAID (small)

const args = Object.fromEntries(
  process.argv
    .slice(3)
    .map((a) => a.replace(/^--/, '').split('='))
    .map(([k, ...v]) => [k, v.join('=') || 'yes']),
) as Record<string, string>

const ctx: JobContext = {
  progress: (f, m) => m && console.log(`[${Math.round(f * 100)}%] ${m}`),
  log: (m) => console.log(m),
}

function request() {
  const roots: DatabentoRoot[] = args.roots ? args.roots.split(',') : [...DATABENTO_ROOTS]
  const unknown = roots.filter((r) => !isDatabentoRoot(r))
  if (unknown.length) throw new Error(`Unknown root(s) ${unknown.join(', ')}; expected one of ${DATABENTO_ROOTS.join(', ')}`)
  const schemas = (args.schemas ? args.schemas.split(',') : [...DATABENTO_SCHEMAS]) as DatabentoSchema[]
  return { roots, schemas, start: args.start ?? DATABENTO_HISTORY_START, end: args.end, maxCost: args.maxCost ? Number(args.maxCost) : undefined, windowMonths: args.windowMonths ? Number(args.windowMonths) : undefined }
}

async function main(cmd: string | undefined): Promise<void> {
  switch (cmd) {
    case 'freshness':
      console.table(freshness().rows.map((r) => ({ dataset: r.dataset, source: r.source, rows: r.rows, symbols: r.symbols, from: r.from, to: r.to, stale: r.stale })))
      return
    case 'yahoo':
      console.log(await ingestYahoo(ctx))
      return
    case 'estimate': {
      const client = databentoClient()
      if (!client) throw new Error('DATABENTO_API_KEY is not set')
      const e = await estimate(client, request(), env.databentoBudget)
      console.table(e.lines)
      console.log(`Total $${e.total.toFixed(4)} for ${e.start} → ${e.end} (budget $${e.budget}; ${e.withinBudget ? 'within' : 'OVER'} budget). FREE — nothing downloaded.`)
      return
    }
    case 'backfill':
      if (args.confirm !== 'yes') {
        console.log('Dry run: add confirm=yes to download. Estimating (free)…')
        return main('estimate')
      }
      console.log(await runBackfill(ctx, request()))
      return
    case 'incremental':
      console.log(await runIncremental(ctx, { maxCost: args.maxCost ? Number(args.maxCost) : undefined }))
      return
    default:
      throw new Error(`Unknown command '${cmd}'. Use freshness | yahoo | estimate | backfill | incremental`)
  }
}

main(process.argv[2]).catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
