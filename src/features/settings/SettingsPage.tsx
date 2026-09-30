import { useQuery } from '@tanstack/react-query'
import type { IntegrationStatus } from '@shared/api'
import { api } from '../../api/client'
import { Chip, DataTable, PageHeader, Panel, PanelSkeleton, ErrorNote, type Column } from '../../ui'

interface IntegrationRow {
  key: string
  name: string
  envVar: string
  purpose: string
  configured: boolean
  detail?: string
}

export default function SettingsPage() {
  const status = useQuery({
    queryKey: ['status'],
    queryFn: async () => (await api.get<IntegrationStatus>('/status')).data,
  })

  const rows: IntegrationRow[] = status.data
    ? [
        {
          key: 'databento',
          name: 'Databento',
          envVar: 'DATABENTO_API_KEY',
          purpose: 'Historical CME contract data (GC, MGC, SI, SIL) for spreads, butterflies and seasonality.',
          configured: status.data.databento,
        },
        {
          key: 'openrouter',
          name: 'OpenRouter',
          envVar: 'OPENROUTER_API_KEY',
          purpose: 'AI macro briefs, trade briefs and portfolio commentary.',
          configured: status.data.openrouter,
          detail: status.data.openrouterModel ?? undefined,
        },
        {
          key: 'fred',
          name: 'FRED',
          envVar: 'FRED_API_KEY',
          purpose: 'Macro series: real yields, breakevens, broad dollar, CPI, Fed funds, M2.',
          configured: status.data.fred,
        },
        {
          key: 'db',
          name: 'Local database',
          envVar: 'DB_PATH',
          purpose: 'SQLite file holding the ledger, prices, reports and model outputs.',
          configured: status.data.dbReady,
          detail: status.data.dbPath,
        },
      ]
    : []

  const columns: Column<IntegrationRow>[] = [
    { key: 'name', header: 'Integration', cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'purpose', header: 'Used for', cell: (r) => <span className="text-muted">{r.purpose}</span> },
    { key: 'env', header: 'Variable', cell: (r) => <code className="num text-xs">{r.envVar}</code> },
    {
      key: 'state',
      header: 'Status',
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <Chip tone={r.configured ? 'strong' : 'neutral'}>{r.configured ? 'Configured' : 'Not set'}</Chip>
          {r.detail && <span className="num break-all text-2xs text-muted">{r.detail}</span>}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="Integrations and fund configuration. Keys live in the server's .env file and are never sent to the browser."
      />
      <Panel title="Integrations">
        {status.isLoading ? (
          <PanelSkeleton />
        ) : status.error ? (
          <ErrorNote error={status.error} onRetry={() => status.refetch()} />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} />
        )}
      </Panel>
    </>
  )
}
