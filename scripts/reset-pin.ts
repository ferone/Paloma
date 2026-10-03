// Forgotten admin PIN: `npm run admin:reset-pin`. Removes the stored PIN hash so the
// next settings change asks for a new PIN. It needs access to this machine's files,
// which is the same trust boundary as the PIN itself (the server is local-only).
// Saved API keys are not touched.
import { getDb } from '../server/db/client.js'

const r = getDb().prepare("DELETE FROM settings WHERE key = 'admin.pinHash'").run()
console.log(r.changes ? 'Admin PIN removed. Open Settings and choose a new PIN on the next change.' : 'No admin PIN was set.')
