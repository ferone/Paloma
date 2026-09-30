// Cross-cutting API contracts shared by server and client.
// Domain-specific contracts live in shared/<domain>.ts (owned by each domain).

/** Every server response that can be partial or unconfigured uses this envelope. */
export interface Provenance {
  source: string
  /** ISO date of the latest data point included. */
  asOf: string | null
  /** True when figures are estimated/modeled rather than observed. */
  modeled?: boolean
  note?: string
}

export interface NotConfigured {
  status: 'not_configured'
  /** Env var(s) the user must set. */
  missing: string[]
  message: string
}

export interface IntegrationStatus {
  databento: boolean
  openrouter: boolean
  fred: boolean
  openrouterModel: string | null
  dbPath: string
  dbReady: boolean
}

export type JobState = 'idle' | 'running' | 'succeeded' | 'failed'

export interface JobStatus {
  name: string
  state: JobState
  startedAt: string | null
  finishedAt: string | null
  message: string | null
  progress?: number
}
