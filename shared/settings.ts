// Contracts for the editable configuration surface (Settings → API keys, admin PIN).

export type KeySource = 'settings' | 'env' | 'none'

export interface SecretView {
  name: string
  label: string
  purpose: string
  docsUrl: string
  required: boolean
  configured: boolean
  source: KeySource
  /** "••••abcd" — the only part of a value ever sent to the browser. */
  masked: string | null
  updatedAt: string | null
  /** A saved key exists but the machine key (data/secret.key) can no longer decrypt it. */
  unreadable: boolean
}

export interface SecretsResponse {
  secrets: SecretView[]
  keyFile: string
}

export interface SecretTestResult {
  ok: boolean
  message: string
  /** Extra facts the provider returns (e.g. OpenRouter credit limit and usage). */
  detail?: Record<string, string | number | null>
}

export interface AdminStatus {
  pinSet: boolean
  unlocked: boolean
  /** Seconds until a lockout after repeated wrong PINs ends (0 = not locked). */
  lockedForSec: number
}

export interface AdminUnlockResponse {
  token: string
  expiresInSec: number
}

export interface GeneralSettings {
  databentoBudget: number
}
