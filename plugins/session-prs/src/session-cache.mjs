import { sessionPullReferences } from './session-refs.mjs'

/** One cache per plugin window, independent of individual panel mounts. */
export function createSessionCache({ getRefs, read, update, history = sessionPullReferences, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  const previous = new Map(), results = new Map(), delayed = new Map(), deferredKeys = new Set()
  let disposed = false, busy = false, refreshRequested = false, syncRequested = false
  let lastSync = null, lastRefs = ''
  const signature = (refs) => JSON.stringify(refs.map((ref) => ref.key))

  async function sync(refs, manual = false, onlyKey) {
    if (disposed) return
    if (busy) {
      if (manual && onlyKey) deferredKeys.add(onlyKey)
      else if (manual) refreshRequested = true
      else syncRequested = true
      return
    }
    busy = true
    try {
      const servers = [...new Set(refs.map((ref) => ref.server))]
      const active = new Map(await Promise.all(servers.map(async (server) => {
        try { return [server, await server.client.session.active()] }
        catch { return [server, null] }
      })))
      const sessions = await Promise.all(refs.map(async (ref) => {
        try {
          const info = await ref.server.client.session.get({ sessionID: ref.id })
          const running = active.get(ref.server)
          return { key: ref.key, id: ref.id, title: info.title || ref.id, directory: info.location?.directory, local: ref.server.local, active: running ? !!running[ref.id] : null, outcome: info.outcome }
        } catch {
          return { key: ref.key, id: ref.id, title: ref.id, directory: undefined, active: null, outcome: undefined }
        }
      }))
      if (disposed) return
      const keys = new Set(sessions.map((session) => session.key))
      for (const key of previous.keys()) if (!keys.has(key)) {
        previous.delete(key); results.delete(key)
        const timeout = delayed.get(key)
        if (timeout) cancel(timeout)
        delayed.delete(key)
      }
      await Promise.all(sessions.map(async (session) => {
        const old = previous.get(session.key)
        const completed = old?.active === true && session.active === false
        const directory = session.directory || ''
        const needsLookup = (manual && (!onlyKey || onlyKey === session.key)) || !old || old.directory !== directory || completed
        previous.set(session.key, { active: session.active === true, directory })
        if (!needsLookup) return
        try {
          let references
          try { references = await history(refs.find((ref) => ref.key === session.key).server.client, session.id) }
          catch { references = { urls: [], directories: [], unavailable: true } }
          const response = await read({ directory: session.local ? directory : '', directories: session.local ? references.directories || [] : [], urls: references.urls || [] })
          if (disposed) return
          const data = response.data || {}
          results.set(session.key, { ...data, prs: data.prs || (data.pr ? [data.pr] : []), historyTruncated: references.truncated, historyUnavailable: references.unavailable, historyIncomplete: references.incomplete })
          if (completed && response.cached && !delayed.has(session.key)) {
            const timeout = schedule(() => {
              delayed.delete(session.key)
              if (!disposed && previous.has(session.key)) void sync(getRefs(), true, session.key)
            }, Math.max(0, response.checkedAt + 60100 - now()))
            delayed.set(session.key, timeout)
          }
        } catch (error) {
          if (!disposed) results.set(session.key, { note: `Lookup failed: ${error instanceof Error ? error.message : String(error)}` })
        }
      }))
      if (disposed) return
      lastSync = now()
      lastRefs = signature(refs)
      update({ rows: sessions.map((session) => ({ ...session, result: results.get(session.key) })), message: sessions.length ? '' : 'No open OpenCode sessions in this window.', ...(manual && !onlyKey ? { lastRefresh: `Refresh requested ${new Date(now()).toLocaleTimeString()}` } : {}) })
    } finally {
      busy = false
      if (!disposed && refreshRequested) { refreshRequested = false; syncRequested = false; deferredKeys.clear(); void sync(getRefs(), true) }
      else if (!disposed && deferredKeys.size) {
        const key = deferredKeys.values().next().value
        if (key) { deferredKeys.delete(key); void sync(getRefs(), true, key) }
      } else if (!disposed && syncRequested) { syncRequested = false; void sync(getRefs()) }
    }
  }

  return {
    sync,
    // Reopening a just-refreshed view should not re-read every session.
    syncIfNeeded(refs) {
      if (lastSync !== null && signature(refs) === lastRefs && now() - lastSync < 10000) return
      return sync(refs)
    },
    dispose() {
      disposed = true
      for (const timeout of delayed.values()) cancel(timeout)
      delayed.clear()
    },
  }
}
