import { parsePullUrl } from './github.mjs'

/** Per-window snapshots survive panel unmounts; the backend owns GitHub rate limiting. */
export function createViewCache({ read, now = Date.now, ttl = 60_000, limit = 50 }) {
  const snapshots = new Map(), inflight = new Map()
  const keyFor = (url) => {
    const ref = parsePullUrl(url)
    if (!ref) throw new Error('Enter a valid github.com pull request URL.')
    return ref.url.toLowerCase()
  }
  return {
    get(url) {
      const key = keyFor(url), value = snapshots.get(key)
      if (!value) return undefined
      snapshots.delete(key); snapshots.set(key, value)
      return { ...value, cached: true, fresh: now() - value.checkedAt < ttl }
    },
    load(url, { force = false } = {}) {
      const key = keyFor(url)
      const existing = inflight.get(key)
      if (existing && !force) return existing.promise
      const entry = {}
      entry.promise = Promise.resolve().then(() => read(url, { force })).then((result) => {
        if (inflight.get(key) === entry) {
          snapshots.delete(key); snapshots.set(key, result)
          while (snapshots.size > limit) snapshots.delete(snapshots.keys().next().value)
        }
        return result
      }).finally(() => { if (inflight.get(key) === entry) inflight.delete(key) })
      inflight.set(key, entry)
      return entry.promise
    },
    invalidate(url) {
      const key = keyFor(url)
      snapshots.delete(key)
      // An older request must not repopulate an invalidated snapshot.
      inflight.delete(key)
    },
  }
}
