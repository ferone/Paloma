// Tiny TTL cache with in-flight de-duplication. On failure it serves the last
// good value (if any) so a Yahoo hiccup doesn't blank the page.
interface Entry {
  expires: number
  value?: unknown
  pending?: Promise<unknown>
}

const store = new Map<string, Entry>()

export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.value !== undefined && hit.expires > now) return hit.value as T
  if (hit?.pending) return hit.pending as Promise<T>

  const pending = fn()
    .then((value) => {
      store.set(key, { value, expires: Date.now() + ttlMs })
      return value
    })
    .catch((err) => {
      const prev = store.get(key)
      if (prev && prev.value !== undefined) {
        store.set(key, { value: prev.value, expires: Date.now() + Math.min(ttlMs, 30_000) })
        return prev.value as T
      }
      store.delete(key)
      throw err
    })
  store.set(key, { ...(hit ?? { expires: 0 }), pending })
  return pending
}

/** Test helper. */
export function clearMemo(): void {
  store.clear()
}
