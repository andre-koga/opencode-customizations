import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { applyGithubAction, availableActions, conversationCount, findingsSummary, makeReader, parsePullUrl, primaryAction, readBaseChain, readPull, readUnresolvedThreads } from '../src/github.mjs'

test('accepts only genuine GitHub PR URLs and canonicalizes paths and fragments', () => {
  assert.deepEqual(parsePullUrl('https://github.com/acme/widget/pull/42/files#diff-1'), { owner: 'acme', repo: 'widget', number: 42, url: 'https://github.com/acme/widget/pull/42' })
  for (const url of ['https://github.com.evil.test/a/b/pull/1', 'https://user@github.com/a/b/pull/1', 'http://github.com/a/b/pull/1', 'https://github.com/a/b/issues/1', 'https://github.com/a/b/pull/0', 'https://github.com/a/b/pull/1;rm', 'file:///tmp/a', 'not-a-url']) assert.equal(parsePullUrl(url), null, url)
})

const pull = { title: 'Example', body: 'Body', state: 'open', draft: false, user: { login: 'author' }, head: { sha: 'a'.repeat(40), ref: 'feature' }, base: { ref: 'dev' }, changed_files: 1, updated_at: '2026-11-10T18:00:00Z' }

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
  const result = await readPull('https://github.com/acme/widget/pull/42', api, async () => true)
  assert.equal(paths.length, 7)
  assert.equal(result.pull.title, 'Example')
  assert.equal(result.pull.updatedAt, '2026-11-10T18:00:00Z')
  assert.equal(result.reviews[0].state, 'APPROVED')
  assert.equal(result.comments[0].body, 'hello')
  assert.equal(result.inline[0].path, 'file.ts')
  assert.equal(result.files[0].patch, '+ok')
  assert.equal(result.checks[0].conclusion, 'success')
  assert.equal(result.unresolvedThreads, true)
})

test('reports failed sections instead of hiding available data', async () => {
  const api = async (path) => {
    if (/\/pulls\/42$/.test(path)) return pull
    if (path.includes('/reviews?')) throw Error('unavailable')
    if (path.includes('/check-runs?')) return { check_runs: [] }
    if (path.includes('/status?')) return { statuses: [] }
    return []
  }
  const result = await readPull('https://github.com/acme/widget/pull/42', api, async () => { throw Error('unavailable') })
  assert.equal(result.reviews, null)
  assert.deepEqual(result.comments, [])
  assert.equal(result.unresolvedThreads, null)
})

const chainRef = parsePullUrl('https://github.com/acme/widget/pull/42')
const chainPull = (head, base, defaultBranch = 'dev') => ({ head: { ref: head }, base: { ref: base, repo: { full_name: 'acme/widget', default_branch: defaultBranch } } })
const parentPull = (number, head, base, repo = 'acme/widget') => ({ number, head: { ref: head, repo: { full_name: repo } }, base: { ref: base, repo: { full_name: 'acme/widget' } } })

test('follows the base-branch chain to the actual default branch, with canonical PR links', async () => {
  const paths = []
  const api = async (path) => {
    paths.push(path)
    if (path.includes('head=acme%3Amiddle%2Fbranch')) return [parentPull(41, 'middle/branch', 'bottom')]
    if (path.includes('head=acme%3Abottom')) return [parentPull(40, 'bottom', 'dev')]
    throw Error('unexpected path')
  }
  const chain = await readBaseChain(chainRef, chainPull('top', 'middle/branch'), api)
  assert.deepEqual(chain, { chain: [
    { branch: 'top', number: 42, url: 'https://github.com/acme/widget/pull/42' },
    { branch: 'middle/branch', number: 41, url: 'https://github.com/acme/widget/pull/41' },
    { branch: 'bottom', number: 40, url: 'https://github.com/acme/widget/pull/40' },
  ], target: 'dev', status: 'complete' })
  assert.equal(paths.length, 2)
  assert.equal(await readBaseChain(chainRef, chainPull('feature', 'dev'), api), null)
  assert.equal(await readBaseChain(chainRef, { head: { ref: 'feature' }, base: { ref: 'dev' } }, api), null)
})

test('never invents parents for missing, ambiguous, forked, failed, or cyclic chains', async () => {
  const start = chainPull('top', 'parent')
  const result = async (api) => readBaseChain(chainRef, start, api)
  assert.equal((await result(async () => [])).status, 'missing')
  assert.equal((await result(async () => [parentPull(1, 'parent', 'dev'), parentPull(2, 'parent', 'dev')])).status, 'ambiguous')
  assert.equal((await result(async () => [parentPull(1, 'parent', 'dev', 'other/widget')])).status, 'missing')
  assert.equal((await result(async () => { throw Error('offline') })).status, 'unavailable')
  assert.equal((await result(async () => Array(100).fill(parentPull(1, 'parent', 'dev')))).status, 'unavailable')
  const cycle = await result(async () => [parentPull(1, 'parent', 'top')])
  assert.equal(cycle.status, 'cycle')
  assert.equal(cycle.target, 'top')
  assert.equal(cycle.chain.length, 2)
})

test('bounds chain lookups and returns the partial chain', async () => {
  let count = 0
  const result = await readBaseChain(chainRef, chainPull('top', 'layer0'), async () => {
    const index = count++
    return [parentPull(index + 1, `layer${index}`, `layer${index + 1}`)]
  })
  assert.equal(count, 10)
  assert.equal(result.status, 'limit')
  assert.equal(result.target, 'layer10')
  assert.equal(result.chain.length, 11)
})

test('chain lookup failure does not prevent loading the PR', async () => {
  const api = async (path) => {
    if (/\/pulls\/42$/.test(path)) return { ...pull, ...chainPull('top', 'parent'), head: { ...pull.head, ref: 'top' } }
    if (path.includes('/pulls?')) throw Error('offline')
    if (path.includes('/check-runs?')) return { check_runs: [] }
    if (path.includes('/status?')) return { statuses: [] }
    return []
  }
  const result = await readPull(chainRef.url, api, async () => false)
  assert.equal(result.pull.title, 'Example')
  assert.equal(result.baseChain.status, 'unavailable')
})

test('reads review thread resolution conservatively, including partial pages', async () => {
  const ref = { owner: 'acme', repo: 'widget', number: 42 }
  const response = (nodes, hasNextPage) => async (command, args) => {
    assert.equal(command, 'gh')
    assert.ok(args.includes('graphql'))
    assert.ok(args.includes('owner=acme'))
    assert.ok(args.includes('number=42'))
    return { stdout: JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes, pageInfo: { hasNextPage } } } } } }) }
  }
  assert.equal(await readUnresolvedThreads(ref, response([{ isResolved: false }], false)), true)
  assert.equal(await readUnresolvedThreads(ref, response([{ isResolved: true }], false)), false)
  assert.equal(await readUnresolvedThreads(ref, response([{ isResolved: false }], true)), true)
  assert.equal(await readUnresolvedThreads(ref, response([{ isResolved: true }], true)), null)
  await assert.rejects(readUnresolvedThreads(ref, response([{}], false)), /unavailable/)
})

test('counts comments and review bodies, marking partial and unavailable counts', () => {
  const data = { comments: [{}, {}], inline: [{}], reviews: [{ body: 'feedback' }, { body: '' }, { body: ' ' }], limited: [] }
  assert.equal(conversationCount(data), '4')
  assert.equal(conversationCount({ ...data, limited: ['inline'] }), '4+')
  assert.equal(conversationCount({ ...data, reviews: null }), '?')
  assert.equal(conversationCount({ ...data, comments: [], inline: [], reviews: [] }), '0')
})

test('shows the latest bot finding count separately and flags outdated or incomplete data', () => {
  const head = 'a'.repeat(40)
  const marker = (sha, n) => `<!-- review-done sha=${sha} findings=${n} -->`
  const data = {
    pull: { sha: head }, limited: [],
    comments: [
      { author: 'github-actions[bot]', date: '2026-01-02T00:00:00Z', body: marker(head, 5) },
      { author: 'github-actions[bot]', date: '2026-01-01T00:00:00Z', body: marker('b'.repeat(40), 2) },
      { author: 'someone-else', date: '2026-01-03T00:00:00Z', body: marker(head, 99) },
    ],
  }
  assert.equal(findingsSummary(data).label, '5')
  assert.equal(findingsSummary({ ...data, pull: { sha: 'b'.repeat(40) } }).label, '5, outdated')
  assert.equal(findingsSummary({ ...data, pull: {} }).label, '5, unknown')
  assert.equal(findingsSummary({ ...data, comments: [] }).label, '—')
  assert.equal(findingsSummary({ ...data, comments: null }).label, '?')
  assert.equal(findingsSummary({ ...data, limited: ['comments'] }).label, '?')
  assert.equal(findingsSummary({ ...data, comments: [{ author: 'github-actions[bot]', body: marker(head, 0) }] }).label, '0')
  assert.equal(findingsSummary({ ...data, comments: [{ author: 'github-actions[bot]', body: `<!-- review-done sha=${head} findings=-1 -->` }] }).label, '?')
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

test('forced reads bypass the backend cache and cannot be overwritten by older requests', async () => {
  let finishOld, count = 0
  const old = new Promise((resolve) => { finishOld = resolve })
  const reader = makeReader({ now: () => 100, read: async () => ++count === 1 ? old : { version: count } })
  const first = reader(chainRef.url)
  const forced = await reader(chainRef.url, { force: true })
  assert.equal(forced.cached, false)
  assert.equal(forced.data.version, 2)
  finishOld({ version: 1 })
  assert.equal((await first).data.version, 1)
  const cached = await reader(chainRef.url)
  assert.equal(cached.cached, true)
  assert.equal(cached.data.version, 2)
  assert.equal(count, 2)
})

const ready = () => ({
  pull: { state: 'Open', sha: 'a'.repeat(40), mergeable: true, mergeableState: 'clean' },
  checks: [{ name: 'build', status: 'completed', conclusion: 'success' }],
  statuses: [], reviews: [], comments: [], unresolvedThreads: false, limited: [],
})

test('offers draft, conflicts, and review or CI actions independently', () => {
  const d = ready()
  const failed = [{ status: 'completed', conclusion: 'failure' }]
  const draft = { ...d, pull: { ...d.pull, state: 'Draft' } }
  assert.deepEqual(availableActions(draft).map((a) => a.kind), ['draft'])
  const problems = { ...draft, checks: failed, unresolvedThreads: true }
  const actions = availableActions(problems)
  assert.deepEqual(actions.map((a) => a.kind), ['draft', 'blocked'])
  assert.match(actions[1].task, /CI\/CD.*unresolved review comments/)
  const conflict = { ...problems, pull: { ...draft.pull, mergeable: false } }
  assert.deepEqual(availableActions(conflict).map((a) => a.kind), ['draft', 'conflict', 'blocked'])
  assert.deepEqual(availableActions({ ...conflict, pull: { ...conflict.pull, state: 'Open' } }).map((a) => a.kind), ['conflict', 'blocked'])
  assert.deepEqual(availableActions({ ...conflict, pull: { ...conflict.pull, state: 'Closed' } }).map((a) => a.kind), ['closed'])
  assert.deepEqual(availableActions({ ...d, checks: failed }).map((a) => a.kind), ['blocked'])
  assert.deepEqual(availableActions(d).map((a) => a.kind), ['ready'])
})

test('independent actions respect partial data and current review findings', () => {
  const d = ready()
  const draft = { ...d, pull: { ...d.pull, state: 'Draft' }, checks: null, unresolvedThreads: null }
  assert.deepEqual(availableActions(draft).map((a) => a.kind), ['draft'])
  const withFindings = { ...draft, comments: [{ author: 'github-actions[bot]', body: `<!-- review-done sha=${d.pull.sha} open=2 -->` }] }
  assert.equal(availableActions(withFindings)[1].label, 'Ask agent to fix review findings (2)')
  assert.deepEqual(availableActions({ ...withFindings, limited: ['comments'] }).map((a) => a.kind), ['draft'])
  const feedback = { ...draft, reviews: [{ author: 'reviewer', state: 'CHANGES_REQUESTED' }] }
  assert.equal(availableActions(feedback)[1].label, 'Ask agent to address review feedback')
})

test('latest open marker supersedes old findings without masking independent merge blockers', () => {
  const d = ready(), old = 'b'.repeat(40)
  const comments = [
    { author: 'github-actions[bot]', date: '2026-01-01', body: `<!-- review-done sha=${old} findings=5 -->` },
    { author: 'github-actions[bot]', date: '2026-01-02', body: `<!-- review-done sha=${d.pull.sha} open=0 -->` },
  ]
  const data = { ...d, comments }
  assert.equal(findingsSummary(data).label, '0')
  assert.equal(primaryAction(data).kind, 'ready')
  assert.equal(primaryAction({ ...data, unresolvedThreads: true }).label, 'Ask agent to resolve comments')
  assert.equal(primaryAction({ ...data, pull: { ...d.pull, mergeableState: 'blocked' } }).kind, 'blocked')
  assert.equal(primaryAction({ ...data, checks: [{ status: 'completed', conclusion: 'failure' }] }).kind, 'blocked')
  const both = { ...d, comments: [{ author: 'github-actions[bot]', body: `<!-- review-done findings=5 open=0 sha=${d.pull.sha} -->` }] }
  assert.equal(findingsSummary(both).label, '0')
  assert.equal(primaryAction(both).kind, 'ready')
  assert.equal(primaryAction({ ...d, comments: [{ author: 'github-actions[bot]', body: `<!-- review-done sha=${d.pull.sha} findings=0 open=2 -->` }] }).kind, 'blocked')
  assert.equal(findingsSummary({ ...data, comments: [...comments, { author: 'github-actions[bot]', date: '2026-01-03', body: `<!-- review-done sha=${d.pull.sha} open=bad -->` }] }).label, '?')
  assert.equal(primaryAction({ ...data, comments: [...comments, { author: 'github-actions[bot]', date: '2026-01-03', body: `<!-- review-done sha=${d.pull.sha} open=bad -->` }] }).kind, 'unknown')
})

test('fresh merge check still rejects unresolved threads even with open zero', async () => {
  const d = ready()
  let called = false
  await assert.rejects(applyGithubAction({ url: 'https://github.com/acme/repo/pull/42', action: 'merge', expectedHead: d.pull.sha }, {
    read: async () => ({ ...d, unresolvedThreads: true, comments: [{ author: 'github-actions[bot]', body: `<!-- review-done sha=${d.pull.sha} open=0 -->` }] }),
    run: async () => { called = true },
  }), /no longer ready/)
  assert.equal(called, false)
})

test('blocks current bot findings but not zero, outdated, or absent markers', () => {
  const d = ready()
  const marker = (sha, count) => ({ author: 'github-actions[bot]', body: `<!-- review-done sha=${sha} findings=${count} -->` })
  const current = { ...d, comments: [marker(d.pull.sha, 2)] }
  const action = primaryAction(current)
  assert.equal(action.kind, 'blocked')
  assert.equal(action.label, 'Ask agent to fix review findings (2)')
  assert.match(action.task, /2 current bot review findings/)
  assert.equal(primaryAction({ ...current, checks: [{ status: 'completed', conclusion: 'failure' }] }).label, 'Ask agent to fix CI/CD and resolve comments')
  assert.match(primaryAction({ ...current, unresolvedThreads: true }).task, /unresolved review comments.*2 current bot review findings/)
  assert.equal(primaryAction({ ...d, comments: [marker(d.pull.sha, 0)] }).kind, 'ready')
  assert.equal(primaryAction({ ...d, comments: [marker('b'.repeat(40), 2)] }).kind, 'ready')
  assert.equal(primaryAction(d).kind, 'ready')
  assert.equal(primaryAction({ ...d, comments: null }).kind, 'unknown')
  assert.equal(primaryAction({ ...current, limited: ['comments'] }).kind, 'unknown')
  assert.equal(primaryAction({ ...current, pull: { ...d.pull, state: 'Draft' } }).kind, 'draft')
})

test('fresh merge recheck rejects current findings without calling GitHub merge', async () => {
  let called = false
  const d = ready()
  const data = { ...d, comments: [{ author: 'github-actions[bot]', body: `<!-- review-done sha=${d.pull.sha} findings=2 -->` }] }
  await assert.rejects(applyGithubAction({ url: 'https://github.com/acme/repo/pull/42', action: 'merge', expectedHead: d.pull.sha }, {
    read: async () => data,
    run: async () => { called = true; return { stdout: '{"merged":true}' } },
  }), /no longer ready/)
  assert.equal(called, false)
})

test('labels and prompts match known CI and unresolved-comment blockers', () => {
  const d = ready()
  const failed = [{ status: 'completed', conclusion: 'failure' }]
  const ci = primaryAction({ ...d, checks: failed })
  const comments = primaryAction({ ...d, unresolvedThreads: true })
  const both = primaryAction({ ...d, checks: failed, unresolvedThreads: true })
  assert.equal(ci.label, 'Ask agent to fix CI/CD issues')
  assert.match(ci.task, /CI\/CD/)
  assert.equal(comments.label, 'Ask agent to resolve comments')
  assert.match(comments.task, /unresolved review comments/)
  assert.equal(both.label, 'Ask agent to fix CI/CD and resolve comments')
  assert.match(both.task, /CI\/CD.*unresolved review comments/)
  assert.equal(primaryAction({ ...d, unresolvedThreads: null }).kind, 'unknown')
  assert.equal(primaryAction({ ...d, checks: failed, unresolvedThreads: null }).label, 'Ask agent to fix CI/CD issues')
  assert.equal(primaryAction({ ...d, checks: null, unresolvedThreads: true }).label, 'Ask agent to resolve comments')
  assert.equal(primaryAction({ ...d, reviews: [{ author: 'reviewer', state: 'CHANGES_REQUESTED' }] }).label, 'Ask agent to address review feedback')
  assert.equal(primaryAction({ ...d, pull: { ...d.pull, mergeableState: 'blocked' } }).label, 'Ask agent to fix issues')
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

test('shows completed successful checks and current status contexts while checks run', () => {
  const d = ready()
  assert.equal(primaryAction({ ...d, checks: [{ status: 'in_progress', conclusion: null }] }).label, 'Checks running (0/1)')
  assert.equal(primaryAction({ ...d, checks: [
    { status: 'completed', conclusion: 'success' },
    { status: 'completed', conclusion: 'skipped' },
    { status: 'in_progress', conclusion: null },
  ], statuses: [
    { name: 'deploy', status: 'success' },
    { name: 'deploy', status: 'failure' },
    { name: 'security', status: 'pending' },
  ] }).label, 'Checks running (2/5)')
  assert.equal(primaryAction({ ...d, checks: [], statuses: [{ name: 'ci', status: 'pending' }] }).label, 'Checks running (0/1)')
  assert.equal(primaryAction({ ...d, checks: [{ status: 'in_progress', conclusion: 'success' }] }).label, 'Checks running (0/1)')
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
