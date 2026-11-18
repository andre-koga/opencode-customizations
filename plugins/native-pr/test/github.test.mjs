import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { applyGithubAction, makeReader, parsePullUrl, primaryAction, readPull } from '../src/github.mjs'

test('accepts only genuine GitHub PR URLs and canonicalizes paths and fragments', () => {
  assert.deepEqual(parsePullUrl('https://github.com/acme/widget/pull/42/files#diff-1'), { owner: 'acme', repo: 'widget', number: 42, url: 'https://github.com/acme/widget/pull/42' })
  for (const url of ['https://github.com.evil.test/a/b/pull/1', 'https://user@github.com/a/b/pull/1', 'http://github.com/a/b/pull/1', 'https://github.com/a/b/issues/1', 'https://github.com/a/b/pull/0', 'https://github.com/a/b/pull/1;rm', 'file:///tmp/a', 'not-a-url']) assert.equal(parsePullUrl(url), null, url)
})

const pull = { title: 'Example', body: 'Body', state: 'open', draft: false, user: { login: 'author' }, head: { sha: 'a'.repeat(40), ref: 'feature' }, base: { ref: 'dev' }, changed_files: 1 }

test('loads details, checks, reviews, discussion and patches using REST paths', async () => {
  const paths = []
  const api = async (path) => {
    paths.push(path)
    if (/\/pulls\/42$/.test(path)) return pull
    if (path.includes('/reviews?')) return [{ id: 1, state: 'APPROVED', user: { login: 'reviewer' } }]
    if (path.includes('/issues/42/comments?')) return [{ id: 2, body: 'hello', user: { login: 'commenter' } }]
    if (path.includes('/pulls/42/comments?')) return [{ id: 3, path: 'file.ts', line: 4, body: 'note' }]
    if (path.includes('/files?')) return [{ filename: 'file.ts', status: 'modified', patch: '+ok' }]
    if (path.includes('/check-runs?')) return { total_count: 1, check_runs: [{ id: 4, name: 'build', status: 'completed', conclusion: 'success' }] }
    if (path.includes('/status?')) return { total_count: 0, statuses: [] }
    throw Error('unexpected path')
  }
  const result = await readPull('https://github.com/acme/widget/pull/42', api)
  assert.equal(paths.length, 7)
  assert.equal(result.pull.title, 'Example')
  assert.equal(result.reviews[0].state, 'APPROVED')
  assert.equal(result.comments[0].body, 'hello')
  assert.equal(result.inline[0].path, 'file.ts')
  assert.equal(result.files[0].patch, '+ok')
  assert.equal(result.checks[0].conclusion, 'success')
})

test('reports failed sections instead of hiding available data', async () => {
  const api = async (path) => {
    if (/\/pulls\/42$/.test(path)) return pull
    if (path.includes('/reviews?')) throw Error('unavailable')
    if (path.includes('/check-runs?')) return { check_runs: [] }
    if (path.includes('/status?')) return { statuses: [] }
    return []
  }
  const result = await readPull('https://github.com/acme/widget/pull/42', api)
  assert.equal(result.reviews, null)
  assert.deepEqual(result.comments, [])
})

test('shares requests, rate limits refreshes, and retries after failure', async () => {
  let time = 0, calls = 0
  const read = async () => { calls++; if (calls === 3) throw Error('offline'); return { call: calls } }
  const reader = makeReader({ read, now: () => time })
  const url = 'https://github.com/acme/widget/pull/42'
  const [one, two] = await Promise.all([reader(url), reader(url)])
  assert.equal(calls, 1); assert.equal(one.cached, false); assert.equal(two.cached, true)
  time = 60_000
  assert.equal((await reader(url)).data.call, 2)
  time = 120_000
  await assert.rejects(reader(url))
  assert.equal((await reader(url)).data.call, 4)
})

const ready = () => ({
  pull: { state: 'Open', sha: 'a'.repeat(40), mergeable: true, mergeableState: 'clean' },
  checks: [{ name: 'build', status: 'completed', conclusion: 'success' }],
  statuses: [], reviews: [], limited: [],
})

test('chooses conservative action states for drafts, conflicts, errors, waiting, and readiness', () => {
  const d = ready()
  assert.equal(primaryAction(d).kind, 'ready')
  assert.equal(primaryAction({ ...d, pull: { ...d.pull, state: 'Draft' } }).kind, 'draft')
  assert.equal(primaryAction({ ...d, pull: { ...d.pull, mergeable: false } }).kind, 'conflict')
  assert.equal(primaryAction({ ...d, pull: { ...d.pull, mergeable: null } }).kind, 'unknown')
  assert.equal(primaryAction({ ...d, checks: null }).kind, 'unknown')
  assert.equal(primaryAction({ ...d, limited: ['checks'] }).kind, 'unknown')
  assert.equal(primaryAction({ ...d, checks: [{ status: 'completed', conclusion: 'failure' }] }).kind, 'blocked')
  assert.equal(primaryAction({ ...d, checks: [{ status: 'in_progress', conclusion: null }] }).kind, 'pending')
  assert.equal(primaryAction({ ...d, checks: [{ status: 'completed', conclusion: null }] }).kind, 'unknown')
  assert.equal(primaryAction({ ...d, statuses: [{ name: 'ci', status: 'expected' }] }).kind, 'pending')
  assert.equal(primaryAction({ ...d, reviews: [{ author: 'reviewer', state: 'CHANGES_REQUESTED' }] }).kind, 'blocked')
  assert.equal(primaryAction({ ...d, reviews: [{ author: 'reviewer', state: 'CHANGES_REQUESTED' }, { author: 'reviewer', state: 'APPROVED' }] }).kind, 'ready')
  assert.equal(primaryAction({ ...d, statuses: [{ name: 'ci', status: 'success' }, { name: 'ci', status: 'failure' }] }).kind, 'ready')
  assert.equal(primaryAction({ ...d, pull: { ...d.pull, mergeableState: 'blocked' } }).kind, 'blocked')
  assert.equal(primaryAction({ ...d, pull: { ...d.pull, state: 'Merged' } }).kind, 'closed')
})

test('confirmed merge rechecks state and sends the expected SHA without force or branch deletion', async () => {
  const calls = []
  const url = 'https://github.com/acme/widget/pull/42'
  const run = async (...args) => { calls.push(args); return { stdout: '{"merged":true}' } }
  await applyGithubAction({ url, action: 'merge', expectedHead: 'a'.repeat(40) }, { read: async () => ready(), run })
  assert.deepEqual(calls[0][1], ['api', '--hostname', 'github.com', '--method', 'PUT', 'repos/acme/widget/pulls/42/merge', '-f', `sha=${'a'.repeat(40)}`, '-f', 'merge_method=merge'])
  await assert.rejects(applyGithubAction({ url, action: 'merge', expectedHead: 'b'.repeat(40) }, { read: async () => ready(), run }), /changed/)
  await assert.rejects(applyGithubAction({ url, action: 'merge', expectedHead: 'a'.repeat(40) }, { read: async () => ({ ...ready(), checks: [{ status: 'completed', conclusion: 'failure' }] }), run }), /no longer ready/)
  assert.equal(calls.length, 1)
})

test('ready action only runs for the same draft commit and invalidates on success when requested', async () => {
  const calls = []
  const input = { url: 'https://github.com/acme/widget/pull/42', action: 'ready', expectedHead: 'a'.repeat(40) }
  const run = async (...args) => { calls.push(args); return { stdout: '' } }
  await applyGithubAction(input, { read: async () => ({ ...ready(), pull: { ...ready().pull, state: 'Draft' } }), run })
  assert.deepEqual(calls[0][1], ['pr', 'ready', '42', '--repo', 'acme/widget'])
  await assert.rejects(applyGithubAction(input, { read: async () => ready(), run }), /no longer a draft/)
  let callsToRead = 0
  const reader = makeReader({ read: async () => ++callsToRead, now: () => 0 })
  await reader(input.url)
  reader.invalidate(input.url)
  assert.equal((await reader(input.url)).data, 2)
})
