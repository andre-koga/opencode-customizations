import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { makeReader, normalizePull } from '../src/github.mjs'

const item = (number, extra = {}) => ({
  number, html_url: `https://github.com/acme/repo/pull/${number}`, title: `PR ${number}`,
  state: 'open', draft: false, comments: 2, updated_at: '2026-01-01T00:00:00Z', pull_request: {}, ...extra,
})

test('normalizes PRs and rejects foreign, forged, or non-PR URLs', () => {
  assert.deepEqual(normalizePull(item(42), 'acme'), { key: 'acme/repo#42', url: 'https://github.com/acme/repo/pull/42', repo: 'repo', number: 42, title: 'PR 42', status: 'Open', updatedAt: '2026-01-01T00:00:00Z', comments: 2 })
  assert.equal(normalizePull(item(42, { draft: true }), 'acme').status, 'Draft')
  assert.equal(normalizePull(item(42, { state: 'closed' }), 'acme').status, 'Closed')
  assert.equal(normalizePull(item(42, { state: 'closed', pull_request: { merged_at: 'now' } }), 'acme').status, 'Merged')
  for (const html_url of ['https://github.com.evil/acme/repo/pull/42', 'https://github.com/other/repo/pull/42', 'https://github.com/acme/repo/issues/42', 'https://github.com/acme/repo/pull/43']) assert.equal(normalizePull(item(42, { html_url }), 'acme'), null)
})

test('paginates authored organization PRs and caches each filter', async () => {
  let time = 0, userCalls = 0, searches = []
  const api = async (path) => {
    if (path === 'user') { userCalls++; return { login: 'octocat' } }
    const params = new URLSearchParams(path.split('?')[1]); searches.push(params)
    const page = Number(params.get('page'))
    return { total_count: 101, incomplete_results: false, items: page === 1 ? Array.from({ length: 100 }, (_, index) => item(index + 1)) : [item(101)] }
  }
  const read = makeReader({ api, now: () => time })
  const [first, shared] = await Promise.all([read({ organization: 'acme', scope: 'open' }), read({ organization: 'ACME', scope: 'open' })])
  assert.equal(userCalls, 1); assert.equal(searches.length, 2)
  assert.equal(first.data.pulls.length, 101); assert.equal(first.data.total, 101)
  assert.equal(first.cached, false); assert.equal(shared.cached, true)
  assert.equal(searches[0].get('q'), 'org:acme author:octocat is:pr is:open')
  assert.equal(searches[1].get('page'), '2')
  time = 59_999; await read({ organization: 'acme', scope: 'open' }); assert.equal(userCalls, 1)
  time = 60_000; await read({ organization: 'acme', scope: 'all' })
  assert.equal(userCalls, 2); assert.equal(searches[2].get('q'), 'org:acme author:octocat is:pr')
})

test('reports incomplete and capped results without polling', async () => {
  let calls = 0
  const api = async (path) => {
    if (path === 'user') return { login: 'octocat' }
    calls++
    return { total_count: 1200, incomplete_results: calls === 1, items: Array.from({ length: 100 }, (_, index) => item((calls - 1) * 100 + index + 1)) }
  }
  const result = await makeReader({ api })({ organization: 'acme', scope: 'all' })
  assert.equal(calls, 10); assert.equal(result.data.pulls.length, 1000)
  assert.equal(result.data.incomplete, true); assert.equal(result.data.limited, true)
})

test('validates inputs and retries after failure', async () => {
  let calls = 0
  const api = async (path) => {
    if (path === 'user') return { login: 'octocat' }
    if (++calls === 1) throw new Error('offline')
    return { total_count: 0, items: [] }
  }
  const read = makeReader({ api, now: () => 0 })
  await assert.rejects(read({ organization: '', scope: 'open' }), /Invalid/)
  await assert.rejects(read({ organization: 'bad org is:public', scope: 'open' }), /Invalid/)
  await assert.rejects(read({ organization: 'acme', scope: 'closed' }), /Invalid/)
  await assert.rejects(read({ organization: 'acme', scope: 'open' }), /offline/)
  assert.deepEqual((await read({ organization: 'acme', scope: 'open' })).data.pulls, [])
  assert.equal(calls, 2)
})
