import 'dotenv/config'
import { getDb, dbPath } from './client.js'

getDb()
console.log(`Migrations applied to ${dbPath()}`)
