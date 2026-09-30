import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import {
  BENCHMARKS,
  TXN_TYPES,
  accountInputSchema,
  importCommitSchema,
  importPreviewSchema,
  physicalItemInputSchema,
  settingsInputSchema,
  transactionInputSchema,
  type BenchmarkId,
  type ImportMapping,
  type ImportPreviewResponse,
  type TransactionsQuery,
} from '../../shared/portfolio.js'
import { autoMap, buildPreview, exportCsv, parseCsv } from './csv.js'
import * as repo from './repo.js'
import { getComputed, invalidate } from './service.js'
import { validateSemantics } from './validate.js'
import { buildAttribution, buildHoldings, buildNavSeries, buildPerformance, buildRisk, buildSummary, buildUnits, buildVault } from './views.js'

// Domain router for /api/portfolio. All bodies are validated with zod; an
// empty ledger yields valid empty shapes from every read endpoint.
export const router = Router()

type Handler = (req: Request, res: Response) => unknown
const wrap =
  (fn: Handler) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      await fn(req, res)
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
      } else if (err instanceof repo.InUseError) {
        res.status(409).json({ error: err.message })
      } else if (err instanceof Error && /UNIQUE constraint failed: pf_accounts.name/.test(err.message)) {
        res.status(409).json({ error: 'An account with that name already exists' })
      } else {
        console.error('[portfolio]', err)
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
      }
    }
  }

const idParam = (req: Request) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw new z.ZodError([{ code: 'custom', path: ['id'], message: 'Invalid id', input: req.params.id }])
  return id
}
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

router.get('/health', (_req, res) => {
  res.json({ domain: 'portfolio', status: 'ok' })
})

// --- Reads computed from the ledger ------------------------------------------

router.get('/summary', wrap(async (_req, res) => res.json(buildSummary(await getComputed()))))
router.get('/holdings', wrap(async (_req, res) => res.json(buildHoldings(await getComputed()))))
router.get('/vault', wrap(async (_req, res) => res.json(buildVault(await getComputed()))))
router.get('/units', wrap(async (_req, res) => res.json(buildUnits(await getComputed()))))

router.get(
  '/nav',
  wrap(async (req, res) => {
    const from = isoDate.optional().parse(str(req.query.from))
    res.json(buildNavSeries(await getComputed(), from))
  }),
)

router.get(
  '/performance',
  wrap(async (req, res) => {
    const benchmark = z
      .enum(BENCHMARKS.map((b) => b.id) as [BenchmarkId, ...BenchmarkId[]])
      .default('GLD')
      .parse(str(req.query.benchmark))
    const from = isoDate.optional().parse(str(req.query.from))
    res.json(await buildPerformance(await getComputed(), benchmark, from))
  }),
)

router.get(
  '/risk',
  wrap(async (req, res) => {
    const lookback = z.coerce.number().int().min(20).max(5000).default(252).parse(str(req.query.lookback))
    res.json(await buildRisk(await getComputed(), lookback))
  }),
)

router.get(
  '/attribution',
  wrap(async (req, res) => {
    const from = isoDate.optional().parse(str(req.query.from))
    const to = isoDate.optional().parse(str(req.query.to))
    res.json(buildAttribution(await getComputed(), from, to))
  }),
)

router.post(
  '/recompute',
  wrap(async (_req, res) => {
    const c = await getComputed({ force: true })
    res.json(buildSummary(c))
  }),
)

// --- Reference data ------------------------------------------------------------

router.get('/instruments', wrap((_req, res) => res.json(repo.listInstruments())))

router.get('/accounts', wrap((_req, res) => res.json(repo.listAccounts())))
router.post(
  '/accounts',
  wrap((req, res) => {
    const acc = repo.createAccount(accountInputSchema.parse(req.body))
    res.status(201).json(acc)
  }),
)
router.put(
  '/accounts/:id',
  wrap((req, res) => {
    const acc = repo.updateAccount(idParam(req), accountInputSchema.parse(req.body))
    if (!acc) return res.status(404).json({ error: 'Account not found' })
    invalidate()
    res.json(acc)
  }),
)
router.delete(
  '/accounts/:id',
  wrap((req, res) => {
    if (!repo.deleteAccount(idParam(req))) return res.status(404).json({ error: 'Account not found' })
    res.status(204).end()
  }),
)

// --- Transactions --------------------------------------------------------------

const txnQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.enum(TXN_TYPES).optional(),
  instrumentId: z.string().optional(),
  accountId: z.coerce.number().int().positive().optional(),
  batch: z.string().optional(),
  q: z.string().optional(),
})

function parseTxnQuery(req: Request): TransactionsQuery {
  return txnQuerySchema.parse(Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, str(v)])))
}

function parseTxnBody(body: unknown) {
  const t = transactionInputSchema.parse(body)
  const instruments = repo.instrumentMap()
  const errors = validateSemantics(t, instruments.get(t.instrumentId))
  if (!repo.getAccount(t.accountId)) errors.push(`Unknown account ${t.accountId}`)
  if (t.counterAccountId && !repo.getAccount(t.counterAccountId)) errors.push(`Unknown destination account ${t.counterAccountId}`)
  if (errors.length) throw new z.ZodError(errors.map((message) => ({ code: 'custom' as const, path: [], message, input: body })))
  return t
}

router.get('/transactions', wrap((req, res) => res.json(repo.listTransactions(parseTxnQuery(req)))))
router.get(
  '/transactions/:id',
  wrap((req, res) => {
    const t = repo.getTransaction(idParam(req))
    if (!t) return res.status(404).json({ error: 'Transaction not found' })
    res.json(t)
  }),
)
router.post(
  '/transactions',
  wrap((req, res) => {
    const t = repo.createTransaction(parseTxnBody(req.body))
    invalidate()
    res.status(201).json(t)
  }),
)
router.put(
  '/transactions/:id',
  wrap((req, res) => {
    const t = repo.updateTransaction(idParam(req), parseTxnBody(req.body))
    if (!t) return res.status(404).json({ error: 'Transaction not found' })
    invalidate()
    res.json(t)
  }),
)
router.delete(
  '/transactions/:id',
  wrap((req, res) => {
    if (!repo.deleteTransaction(idParam(req))) return res.status(404).json({ error: 'Transaction not found' })
    invalidate()
    res.status(204).end()
  }),
)

router.get(
  '/export.csv',
  wrap((req, res) => {
    const csv = exportCsv(repo.listTransactions(parseTxnQuery(req)), repo.listAccounts())
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="ledger-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send(csv)
  }),
)

router.get('/audit', wrap((req, res) => res.json(repo.listAudit({ entity: str(req.query.entity), entityId: str(req.query.entityId) }))))

// --- Physical register -----------------------------------------------------------

router.get('/physical', wrap((_req, res) => res.json(repo.listPhysical())))
router.post(
  '/physical',
  wrap((req, res) => {
    const { recordPurchase, ...item } = physicalItemInputSchema.parse(req.body)
    if (recordPurchase && !repo.getAccount(recordPurchase.accountId)) return res.status(400).json({ error: 'Unknown purchase account' })
    const created = repo.createPhysical(item, recordPurchase)
    invalidate()
    res.status(201).json(created)
  }),
)
router.put(
  '/physical/:id',
  wrap((req, res) => {
    const { recordPurchase: _ignored, ...item } = physicalItemInputSchema.parse(req.body)
    void _ignored
    const updated = repo.updatePhysical(idParam(req), item)
    if (!updated) return res.status(404).json({ error: 'Item not found' })
    invalidate()
    res.json(updated)
  }),
)
router.delete(
  '/physical/:id',
  wrap((req, res) => {
    if (!repo.deletePhysical(idParam(req))) return res.status(404).json({ error: 'Item not found' })
    invalidate()
    res.status(204).end()
  }),
)

// --- CSV import --------------------------------------------------------------------

function preview(body: z.infer<typeof importPreviewSchema>): ImportPreviewResponse & { parseErrors: string[] } {
  const { headers, records, parseErrors } = parseCsv(body.csv)
  const mapping: ImportMapping = body.mapping ? (body.mapping as ImportMapping) : autoMap(headers)
  const rows = buildPreview(records, mapping, {
    instruments: repo.instrumentMap(),
    accounts: repo.listAccounts(),
    defaultAccountId: body.defaultAccountId ?? null,
    existing: repo.listTransactions(),
  })
  return {
    headers,
    mapping,
    rows,
    validCount: rows.filter((r) => r.parsed).length,
    errorCount: rows.filter((r) => r.errors.length).length,
    duplicateCount: rows.filter((r) => r.duplicateOfTxnId || r.duplicateInFile).length,
    parseErrors,
  }
}

router.post('/import/preview', wrap((req, res) => res.json(preview(importPreviewSchema.parse(req.body)))))

router.post(
  '/import/commit',
  wrap((req, res) => {
    const body = importCommitSchema.parse(req.body)
    const p = preview(body)
    if (p.errorCount > 0) return res.status(422).json({ error: `${p.errorCount} rows have errors; fix or remove them before committing.`, preview: p })
    const rows = p.rows.filter((r) => r.parsed && !(body.skipDuplicates && (r.duplicateOfTxnId || r.duplicateInFile)))
    if (rows.length === 0) return res.status(422).json({ error: 'Nothing to import (every row is a duplicate).' })
    const batch = repo.commitBatch(
      rows.map((r) => ({ ...r.parsed!, settleDate: r.parsed!.settleDate ?? null })),
      body.filename ?? null,
    )
    invalidate()
    res.status(201).json({ batch, inserted: rows.length, skipped: p.rows.length - rows.length })
  }),
)

router.get('/import/batches', wrap((_req, res) => res.json(repo.listBatches())))
router.post(
  '/import/:batchId/rollback',
  wrap((req, res) => {
    const batch = repo.getBatch(String(req.params.batchId))
    if (!batch) return res.status(404).json({ error: 'Batch not found' })
    if (batch.status === 'rolled_back') return res.status(409).json({ error: 'Batch already rolled back' })
    const out = repo.rollbackBatch(batch.id)!
    invalidate()
    res.json(out)
  }),
)

// --- Settings ------------------------------------------------------------------------

router.get(
  '/settings',
  wrap(async (_req, res) => {
    const c = await getComputed()
    res.json({ settings: repo.getPortfolioSettings(), effectiveInceptionDate: c.inception })
  }),
)
router.put(
  '/settings',
  wrap(async (req, res) => {
    const patch = settingsInputSchema.parse(req.body)
    const settings = repo.setPortfolioSettings(patch)
    invalidate()
    const c = await getComputed()
    res.json({ settings, effectiveInceptionDate: c.inception })
  }),
)
