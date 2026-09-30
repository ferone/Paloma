// CLI for the ML pipeline (npm run ml:export | ml:train | ml:infer).
//   tsx server/ml/cli.ts export [<asset id>]
//   tsx server/ml/cli.ts train  [<asset id>]
//   tsx server/ml/cli.ts infer
import 'dotenv/config'
import { ASSETS, isAssetId, type AssetId } from '../../shared/universe.js'
import { exportFeatures, refreshYahooInputs } from './data.js'

async function main() {
  const [cmd = 'export', arg] = process.argv.slice(2)
  const metals: AssetId[] = isAssetId(arg) ? [arg] : [...ASSETS]
  const log = (m: string) => console.log(m)
  if (cmd === 'export') {
    await refreshYahooInputs(log)
    for (const m of metals) {
      const r = exportFeatures(m)
      console.log(`${m}: ${r.rows} rows ${r.dataFrom} → ${r.dataThrough} → ${r.csvPath}`)
      for (const [id, why] of Object.entries(r.missing)) console.log(`  missing ${id}: ${why}`)
    }
    return
  }
  const svc = await import('./service.js')
  if (cmd === 'train') {
    for (const m of metals) console.log(await svc.trainMetal(m, { progress: () => {}, log }))
  } else if (cmd === 'infer') {
    console.log(await svc.inferAll({ progress: () => {}, log }))
  } else {
    throw new Error(`Unknown command: ${cmd}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
