import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { buildPlan, isPlanPath, taskProgress } from '../src/plan.mjs'

test('matches only direct Markdown plans', () => {
  assert.equal(isPlanPath('.opencode/plans/demo.md'), true)
  for (const path of ['.opencode/plans/a/b.md', '.opencode/plans/../other.md', 'README.md', '/tmp/.opencode/plans/a.md', '.opencode/plans/a\0.md']) assert.equal(isPlanPath(path), false)
})

test('counts nested and numbered tasks but ignores fenced examples', () => {
  const markdown = '- [x] done\n  - [ ] todo\n1. [X] verified\n```md\n- [ ] example\n```\n~~~\n- [x] example\n~~~\n- [ ] last'
  assert.deepEqual(taskProgress(markdown), { done: 2, total: 4 })
  assert.deepEqual(taskProgress('No tasks'), { done: 0, total: 0 })
})

test('switches the target session before queuing the exact plan', async () => {
  const calls = []
  const session = { id: 'session-1', server: { client: { session: {
    switchAgent: async (value) => calls.push(['switch', value]),
    prompt: async (value) => calls.push(['prompt', value]),
  } } } }
  await buildPlan(session, '/workspace', '.opencode/plans/demo.md')
  assert.deepEqual(calls[0], ['switch', { sessionID: 'session-1', agent: 'build' }])
  assert.equal(calls[1][0], 'prompt')
  assert.equal(calls[1][1].sessionID, 'session-1')
  assert.equal(calls[1][1].delivery, 'queue')
  assert.match(calls[1][1].text, /"\/workspace\/\.opencode\/plans\/demo\.md"/)
  assert.match(calls[1][1].text, /task worktree/)
})

test('does not send if agent switch fails or plan path is invalid', async () => {
  let sent = false
  const session = { id: 'one', server: { client: { session: {
    switchAgent: async () => { throw new Error('switch failed') },
    prompt: async () => { sent = true },
  } } } }
  await assert.rejects(buildPlan(session, '/workspace', '.opencode/plans/demo.md'), /switch failed/)
  await assert.rejects(buildPlan(session, '/workspace', '../other.md'), /Select a plan/)
  assert.equal(sent, false)
})
