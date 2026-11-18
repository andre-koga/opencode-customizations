import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { openActionDraft, primaryActionPrompt } from '../src/thread-action.mjs'
import { sanityCheckPrompt } from '../src/sanity-check.mjs'

const url = 'https://github.com/acme/repo/pull/42/files'

test('new drafts preserve the server, worktree and exact instruction without sending', () => {
  const drafts = []
  const layout = { draft: (input) => drafts.push(input) }
  const session = { server: { id: 'local-server' }, directory: '/worktrees/change' }
  const prompt = sanityCheckPrompt({ url, headSha: 'a'.repeat(40) })
  openActionDraft(layout, session, prompt)
  assert.deepEqual(drafts, [{ server: 'local-server', directory: '/worktrees/change', prompt }])
})

test('primary instructions cover conflicts, CI and comments and normalize the URL', () => {
  const conflict = primaryActionPrompt({ kind: 'conflict' }, url)
  assert.match(conflict, /resolve the merge conflicts for https:\/\/github\.com\/acme\/repo\/pull\/42\./)
  const blocked = primaryActionPrompt({ kind: 'blocked', task: 'Investigate and fix CI/CD failures and address unresolved review comments for' }, url)
  assert.match(blocked, /fix CI\/CD failures and address unresolved review comments/)
  assert.match(blocked, /do not merge the PR/)
  assert.match(primaryActionPrompt({ kind: 'blocked' }, url), /address merge blockers/)
})

test('invalid contexts and non-agent actions do not create drafts', () => {
  let called = false
  const layout = { draft: () => { called = true } }
  assert.throws(() => openActionDraft(layout, undefined, 'text'), /No active/)
  assert.throws(() => openActionDraft(layout, { server: { id: 'server' }, directory: '/worktree' }, ''), /empty/)
  assert.throws(() => primaryActionPrompt({ kind: 'ready' }, url), /cannot be requested/)
  assert.throws(() => primaryActionPrompt({ kind: 'blocked' }, 'https://evil.test/acme/repo/pull/42'), /invalid/)
  assert.equal(called, false)
})
