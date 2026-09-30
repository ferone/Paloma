import { registerJob } from '../jobs/registry.js'
import { publishMacroArtifact, refreshCot, refreshFred } from './service.js'

// Background jobs for the macro domain (run via POST /api/macro/refresh or
// POST /api/jobs/<name>/run). Each run republishes ARTIFACTS.macroDashboard.
let registered = false

export function registerMacroJobs(): void {
  if (registered) return
  registered = true
  registerJob('macro.fred', 'FRED macro series + Yahoo-derived GSR/DXY', async (ctx) => {
    const msg = await refreshFred(ctx)
    publishMacroArtifact()
    return msg
  })
  registerJob('macro.cot', 'CFTC disaggregated COT for COMEX gold and silver', async (ctx) => {
    const msg = await refreshCot(ctx)
    publishMacroArtifact()
    return msg
  })
  registerJob('macro.refresh', 'Full macro refresh: FRED, market series and COT', async (ctx) => {
    const results: string[] = []
    const errors: string[] = []
    try {
      results.push(await refreshFred({ progress: (f, m) => ctx.progress(f * 0.7, m), log: ctx.log }))
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
    try {
      results.push(await refreshCot({ progress: (f, m) => ctx.progress(0.7 + f * 0.3, m), log: ctx.log }))
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
    publishMacroArtifact()
    if (results.length === 0) throw new Error(errors.join(' · '))
    return [...results, ...errors.map((e) => `error: ${e}`)].join(' · ')
  })
}
