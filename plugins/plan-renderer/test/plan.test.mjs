import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { buildPlan, isPlanPath, openTaskPullRequest, stagePlanQuestion, taskProgress } from '../src/plan.mjs'
import { parsePlan } from '../src/plan-format.mjs'

const fixture = readFileSync(new URL('./fixtures/sample-plan.md', import.meta.url), 'utf8')

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
  await buildPlan(session, '/workspace', '.opencode/plans/sample-plan.md', fixture)
  assert.deepEqual(calls[0], ['switch', { sessionID: 'session-1', agent: 'build' }])
  assert.equal(calls[1][0], 'prompt')
  assert.equal(calls[1][1].sessionID, 'session-1')
  assert.equal(calls[1][1].delivery, 'queue')
  assert.match(calls[1][1].text, /"\/workspace\/\.opencode\/plans\/sample-plan\.md"/)
  assert.match(calls[1][1].text, /task worktree/)
  assert.match(calls[1][1].text, /revision 2/)
  assert.match(calls[1][1].text, /snapshot the prior revision/)
  assert.match(calls[1][1].text, /real PR links/)
})

test('does not send if agent switch fails or plan path is invalid', async () => {
  let sent = false
  const session = { id: 'one', server: { client: { session: {
    switchAgent: async () => { throw new Error('switch failed') },
    prompt: async () => { sent = true },
  } } } }
  await assert.rejects(buildPlan(session, '/workspace', '.opencode/plans/sample-plan.md', fixture), /switch failed/)
  await assert.rejects(buildPlan(session, '/workspace', '../other.md', fixture), /Select a plan/)
  await assert.rejects(buildPlan(session, '/workspace', '.opencode/plans/demo.md', fixture), /Normalize and validate/)
  await assert.rejects(buildPlan(session, '/workspace', '.opencode/plans/sample-plan.md', '# Legacy'), /Normalize and validate/)
  assert.equal(sent, false)
})

test('stages a task question with current ID/revision/evidence, preserving existing composer text', () => {
  const calls = [], plan = parsePlan(fixture)
  const composer = { quotable: () => true, text: () => 'My existing draft', attach: (part) => calls.push(['attach', part]), insert: (text) => calls.push(['insert', text]), focus: () => calls.push(['focus']) }
  stagePlanQuestion(composer, { root: '/workspace', path: '.opencode/plans/sample-plan.md', plan, task: plan.tasks[3], question: 'Why is this done?' })
  assert.deepEqual(calls.map((item) => item[0]), ['attach', 'focus'])
  assert.match(calls[0][1].source.subject, /revision 2; task T004, status done/)
  assert.match(calls[0][1].text, /pull\/42/)
  assert.match(calls[0][1].comment, /quoted content may be stale/)
  assert.match(calls[0][1].comment, /Why is this done/)
})

test('stages section questions and normalization requests but never sends them', () => {
  const calls = [], plan = parsePlan(fixture)
  const composer = { quotable: () => true, text: () => '', attach: (part) => calls.push(part), insert: (text) => calls.push(text), focus() {} }
  stagePlanQuestion(composer, { root: '/workspace', path: '.opencode/plans/sample-plan.md', plan, section: plan.sections[0], question: 'Explain the goal' })
  assert.match(calls[0].text, /Make example documentation easier to validate/)
  assert.match(calls[1], /Question about Goal/)
  assert.throws(() => stagePlanQuestion({ quotable: () => false }, { root: '/workspace', path: '.opencode/plans/sample-plan.md', plan, question: 'Ask' }), /active chat/)
})

test('PR navigation uses the existing native viewer, falls back safely, and rejects malicious links', () => {
  const opened = [], session = { id: 's1' }, href = 'https://github.com/example/project/pull/42'
  assert.equal(openTaskPullRequest(() => ({ status: 'active', value: { open: (s, url) => { opened.push([s, url]); return true } } }), session, href, () => assert.fail('no fallback')), 'native')
  assert.equal(opened[0][0], session)
  assert.equal(openTaskPullRequest(() => ({ status: 'inactive' }), session, href, (url) => opened.push(url)), 'external')
  assert.equal(opened[1], href)
  assert.throws(() => openTaskPullRequest(() => assert.fail('no contract access'), session, 'javascript:alert(1)', () => assert.fail('no external call')), /valid GitHub/)
})
