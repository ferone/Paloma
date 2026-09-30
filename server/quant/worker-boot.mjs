// Worker bootstrap: Node 20 does not apply `--import tsx` from worker execArgv,
// so register tsx's ESM hooks inside the worker, then load the TypeScript entry.
import { register } from 'tsx/esm/api'

register()
await import('./worker.ts')
