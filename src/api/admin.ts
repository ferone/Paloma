import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios'

// Admin session for configuration writes. The server answers 401
// { error: 'admin_required' } to a guarded request without a valid token; the
// interceptor then asks the mounted <AdminGate> for the PIN, stores the token
// for this tab and replays the request once. Callers never handle the PIN.

const STORAGE_KEY = 'gid.adminToken'

let memoryToken: string | null = null

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}

export function setAdminToken(token: string | null): void {
  memoryToken = token
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, token)
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // storage blocked: the in-memory copy still works for this page load
  }
}

/** Resolves with a fresh token, or null when the user cancels. Installed by <AdminGate>. */
export type PinPrompter = (pinSet: boolean, message?: string) => Promise<string | null>

let prompter: PinPrompter | null = null
let pending: Promise<string | null> | null = null

export function setPinPrompter(p: PinPrompter | null): void {
  prompter = p
}

/** Ask once even when several guarded requests fail together. */
export function requestAdminToken(pinSet: boolean, message?: string): Promise<string | null> {
  if (!prompter) return Promise.resolve(null)
  pending ??= prompter(pinSet, message).finally(() => (pending = null))
  return pending
}

type Retriable = InternalAxiosRequestConfig & { _adminRetried?: boolean }

export function installAdminInterceptors(api: AxiosInstance): void {
  api.interceptors.request.use((config) => {
    const t = getAdminToken()
    if (t) config.headers.set('X-Admin-Token', t)
    return config
  })
  api.interceptors.response.use(undefined, async (error: AxiosError<{ error?: string; pinSet?: boolean; message?: string }>) => {
    const config = error.config as Retriable | undefined
    const body = error.response?.data
    if (error.response?.status !== 401 || body?.error !== 'admin_required' || !config || config._adminRetried) throw error
    setAdminToken(null)
    const token = await requestAdminToken(!!body.pinSet, body.message)
    if (!token) throw error
    config._adminRetried = true
    config.headers.set('X-Admin-Token', token)
    return api.request(config)
  })
}
