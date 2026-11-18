import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { createViewCache } from '../src/view-cache.mjs'

const url = 'https://github.com/acme/repo/pull/42'

test('keeps a PR snapshot across panel switches and marks it stale after one minute', async () => {
  let time = 1000, reads = 0
  const cache = createViewCache({ now: () => time, read: async () => ({ data: { title: `version ${++reads}` }, checkedAt: time, cached: false }) })
  assert.equal(cache.get(url), undefined)
  await cache.load(url)
  time += 30_000
  assert.equal(cache.get(url).data.title, 'version 1')
  assert.equal(cache.get(url).fresh, true)
  assert.equal(reads, 1)
  time += 30_000
  assert.equal(cache.get(url).fresh, false)
  assert.equal(cache.get(url).data.title, 'version 1')
  await cache.load(url)
  assert.equal(cache.get(url).data.title, 'version 2')
  assert.equal(cache.get(url).fresh, true)
})

test('shares in-flight reads and does not repopulate an invalidated snapshot', async () => {
  let finish, calls = 0
  const pending = new Promise((resolve) => { finish = resolve })
  const cache = createViewCache({ read: async () => { calls++; return pending } })
  const first = cache.load(url), second = cache.load(url)
  await Promise.resolve()
  assert.equal(calls, 1)
  cache.invalidate(url)
  finish({ data: { title: 'old' }, checkedAt: Date.now() })
  await Promise.all([first, second])
  assert.equal(cache.get(url), undefined)
})

test('retains the last good snapshot on refresh failure and supports invalidation', async () => {
  let fail = false
  const cache = createViewCache({ read: async () => {
    if (fail) throw new Error('offline')
    return { data: { title: 'last good' }, checkedAt: 0 }
  }, now: () => 70_000 })
  await cache.load(url)
  fail = true
  await assert.rejects(cache.load(url), /offline/)
  assert.equal(cache.get(url).data.title, 'last good')
  assert.equal(cache.get(url).fresh, false)
  cache.invalidate(url)
  assert.equal(cache.get(url), undefined)
})

test('keys by canonical URL and bounds stored PR snapshots', async () => {
  const cache = createViewCache({ limit: 1, now: () => 1, read: async (target) => ({ data: target, checkedAt: 1 }) })
  await cache.load(url)
  assert.ok(cache.get('https://github.com/ACME/REPO/pull/42/files'))
  await cache.load('https://github.com/acme/repo/pull/43')
  assert.equal(cache.get(url), undefined)
  assert.throws(() => cache.get('https://example.com/acme/repo/pull/1'), /valid/)
})
