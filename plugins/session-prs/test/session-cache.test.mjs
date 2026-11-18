import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { createSessionCache } from '../src/session-cache.mjs'

test('keeps rows across reopen without repeating history or PR lookups', async () => {
  let time = 0, activeCalls = 0, infoCalls = 0, historyCalls = 0, reads = 0, snapshot
  const server = { local: true, client: { session: {
    active: async () => { activeCalls++; return {} },
    get: async ({ sessionID }) => { infoCalls++; return { title: sessionID, location: { directory: '/repo' } } },
  } } }
  const refs = [{ key: 'server\ns1', id: 's1', server }]
  const cache = createSessionCache({
    getRefs: () => refs, now: () => time,
    history: async () => { historyCalls++; return { urls: [], directories: [] } },
    read: async () => { reads++; return { data: { prs: [{ number: 42 }] }, cached: false } },
    update: (value) => { snapshot = value },
  })
  await cache.syncIfNeeded(refs)
  assert.equal(snapshot.rows[0].result.prs[0].number, 42)
  time = 5000
  await cache.syncIfNeeded(refs) // view reopened
  assert.deepEqual([activeCalls, infoCalls, historyCalls, reads], [1, 1, 1, 1])
  assert.equal(snapshot.rows[0].result.prs[0].number, 42)
  time = 10000
  await cache.syncIfNeeded(refs)
  assert.deepEqual([activeCalls, infoCalls, historyCalls, reads], [2, 2, 1, 1])
  await cache.sync(refs, true)
  assert.deepEqual([historyCalls, reads], [2, 2])
  assert.match(snapshot.lastRefresh, /Refresh requested/)
  cache.dispose()
})

test('rechecks changed chats and completions without reloading unaffected histories', async () => {
  let time = 0, running = true, reads = 0, histories = 0, snapshot
  const server = { local: true, client: { session: {
    active: async () => running ? { s1: {} } : {},
    get: async ({ sessionID }) => ({ title: sessionID, location: { directory: `/${sessionID}` } }),
  } } }
  const refs = [{ key: 'server\ns1', id: 's1', server }]
  const cache = createSessionCache({
    getRefs: () => refs, now: () => time,
    history: async () => { histories++; return { urls: [], directories: [] } },
    read: async () => { reads++; return { data: {}, cached: false } },
    update: (value) => { snapshot = value },
  })
  await cache.syncIfNeeded(refs)
  refs.push({ key: 'server\ns2', id: 's2', server })
  await cache.syncIfNeeded(refs)
  assert.equal(snapshot.rows.length, 2)
  assert.deepEqual([histories, reads], [2, 2])
  running = false; time = 10000
  await cache.syncIfNeeded(refs)
  assert.deepEqual([histories, reads], [3, 3])
  refs.shift(); time = 11000
  await cache.syncIfNeeded(refs)
  assert.deepEqual(snapshot.rows.map((row) => row.id), ['s2'])
  assert.deepEqual([histories, reads], [3, 3])
  cache.dispose()
})

test('keeps a deferred completion refresh and cancels it when disposed', async () => {
  let time = 0, running = true, callback, cancelled = false, reads = 0
  const server = { local: true, client: { session: {
    active: async () => running ? { s1: {} } : {},
    get: async () => ({ title: 'chat', location: { directory: '/repo' } }),
  } } }
  const refs = [{ key: 'server\ns1', id: 's1', server }]
  const cache = createSessionCache({
    getRefs: () => refs, now: () => time, update() {},
    history: async () => ({ urls: [], directories: [] }),
    read: async () => { reads++; return { data: {}, cached: reads > 1, checkedAt: 0 } },
    schedule: (fn, delay) => { callback = fn; assert.equal(delay, 50100); return 1 },
    cancel: (id) => { assert.equal(id, 1); cancelled = true },
  })
  await cache.syncIfNeeded(refs)
  running = false; time = 10000
  await cache.syncIfNeeded(refs)
  assert.equal(typeof callback, 'function')
  cache.dispose()
  assert.equal(cancelled, true)
  callback()
  assert.equal(reads, 2)
})

test('reconciles chat changes that arrive while a read is in flight', async () => {
  let release, finished
  const gate = new Promise((resolve) => { release = resolve })
  const completed = new Promise((resolve) => { finished = resolve })
  let reads = 0, snapshot
  const server = { local: true, client: { session: {
    active: async () => ({}),
    get: async ({ sessionID }) => ({ title: sessionID, location: { directory: `/${sessionID}` } }),
  } } }
  let refs = [{ key: 'server\ns1', id: 's1', server }]
  const cache = createSessionCache({
    getRefs: () => refs,
    history: async () => ({ urls: [], directories: [] }),
    read: async () => { if (++reads === 1) await gate; return { data: {}, cached: false } },
    update: (value) => { snapshot = value; if (value.rows.length === 2) finished() },
  })
  const first = cache.syncIfNeeded(refs)
  refs = [...refs, { key: 'server\ns2', id: 's2', server }]
  await cache.syncIfNeeded(refs)
  release()
  await first
  await completed
  assert.deepEqual(snapshot.rows.map((row) => row.id), ['s1', 's2'])
  assert.equal(reads, 2)
  cache.dispose()
})
