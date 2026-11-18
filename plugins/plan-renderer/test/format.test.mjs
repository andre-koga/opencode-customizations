import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { parsePlan, planProgress, PLAN_SECTIONS, pullRequestUrl } from '../src/plan-format.mjs'

export const fixture = readFileSync(new URL('./fixtures/sample-plan.md', import.meta.url), 'utf8')
const messages = (source) => parsePlan(source).diagnostics.map((item) => item.message).join('\n')

test('parses canonical sections, stable IDs, statuses, groups, evidence, and links', () => {
  const plan = parsePlan(fixture)
  assert.equal(plan.valid, true, messages(fixture))
  assert.equal(plan.metadata.revision, '2')
  assert.deepEqual(plan.sections.map((item) => item.title), PLAN_SECTIONS.map((item) => item.title))
  assert.equal(plan.tasks.length, 6)
  assert.equal(plan.tasks[3].id, 'T004')
  assert.equal(plan.tasks[3].prs[0].url, 'https://github.com/example/project/pull/42')
  assert.equal(plan.tasks[3].group, 'Evidence and retired work')
  assert.match(plan.tasks[3].markdown, /Verification: illustrative fixture evidence/)
  assert.deepEqual(planProgress(plan), { done: 1, total: 4, retired: 2, counts: { todo: 1, 'in-progress': 1, blocked: 1, done: 1, cancelled: 1, superseded: 1 } })
})

test('preserves readable legacy and malformed content, never inventing metadata or PRs', () => {
  const plan = parsePlan('# Old plan\n\n## Goal\nDo this\n\n## Other ideas\nKeep me\n- [x] investigated\n- [ ] build')
  assert.equal(plan.standard, false)
  assert.equal(plan.valid, false)
  assert.equal(plan.sections[1].title, 'Other ideas')
  assert.equal(plan.tasks[0].id, 'line-8')
  assert.deepEqual(plan.tasks[0].prs, [])
})

test('code examples, indented code, and blockquotes are not headings or tasks', () => {
  const example = '\n```md\n## Wrong\n- [x] fake\n```\n~~~\n## Also wrong\n~~~\n    ## Indented\n    - [x] fake\n> ## Quoted\n> - [x] fake\n'
  const plan = parsePlan(fixture.replace('## Context\n', `## Context\n${example}`))
  assert.equal(plan.valid, true, plan.diagnostics.map((item) => item.message).join('\n'))
  assert.equal(plan.tasks.length, 6)
  assert.equal(plan.sections.length, 9)
})

test('normalizes CRLF and BOM without losing original line references', () => {
  const plan = parsePlan('\uFEFF' + fixture.replaceAll('\n', '\r\n'))
  assert.equal(plan.valid, true)
  assert.equal(plan.tasks[0].line, parsePlan(fixture).tasks[0].line)
})

test('preserves multiline task notes in the focused checklist', () => {
  const plan = parsePlan(fixture.replace('Notes: keep dependency resolution controlled', 'Notes: keep dependency resolution controlled\n    Keep this previous idea and its rationale.\n    Do not execute customer build scripts.'))
  assert.equal(plan.valid, true)
  assert.match(plan.tasks[1].fields.Notes, /previous idea and its rationale/)
  assert.match(plan.tasks[1].fields.Notes, /Do not execute/)
})

test('validates metadata, title, fixed section ordering, content, and checklist placement', () => {
  for (const [from, to, message] of [
    ['plan-format: 1', 'plan-format: 2', /Unsupported plan-format/],
    ['revision: 2', 'revision: 0', /positive integer/],
    ['implementation: authorized', 'implementation: yes', /implementation must/],
    ['updated: 2026-11-18', 'updated: 2026-02-30', /valid YYYY-MM-DD/],
    ['## Goal', '## A different goal', /documented order/],
    ['## Scope', '## Goal', /documented order/],
    ['# Example documentation tool', 'Introduction\n# Example documentation tool', /precede the plan title/],
    ['## Goal', 'Intro\n## Goal', /introductory content/],
    ['## Context\n\nThe current example has no validation step.', '## Context', /Context must contain/],
  ]) assert.match(messages(fixture.replace(from, to)), message)
  assert.match(messages(fixture + '\n## Appendix\nOops'), /Checklist must be last/)
  assert.match(messages(fixture.replace('## Verification', '# Another title\n\n## Verification')), /exactly one/)
  assert.match(messages(fixture.replace('## Context\n', '## Context\n- [ ] Not a checklist task\n')), /only in Checklist/)
})

test('requires stable IDs, ordered complete fields, valid dependencies, and consistent checkboxes', () => {
  for (const [from, to, message] of [
    ['T002 —', 'T001 —', /Duplicate task ID/],
    ['T001 —', 'No ID —', /stable ID/],
    ['- [ ] **T001', '  - [ ] **T001', /top-level dash/],
    ['Status: todo', 'Status: imaginary', /invalid Status/],
    ['- [ ] **T001', '- [x] **T001', /reserved for Status: done/],
    ['  - PRs: none\n', '', /missing PRs/],
    ['  - Notes: none', '  - Unknown: none', /Unknown or duplicate/],
    ['Depends on: T001', 'Depends on: T999', /invalid dependency/],
    ['Depends on: T001', 'Depends on: T002', /invalid dependency/],
    ['Depends on: T001', 'Depends on: T001 T004', /comma-separated/],
    ['  - Status: todo\n  - Depends on: none', '  - Depends on: none\n  - Status: todo', /documented order/],
  ]) assert.match(messages(fixture.replace(from, to)), message)
  assert.match(messages(fixture.replace('Depends on: none', 'Depends on: T002')), /Dependency cycle/)
})

test('done needs evidence and PRs or a truthful explicit no-PR reason', () => {
  assert.match(messages(fixture.replace('Verification: illustrative fixture evidence — parser tests passed', 'Verification: pending')), /done requires verification/)
  assert.match(messages(fixture.replace('[PR #42](https://github.com/example/project/pull/42)', 'none')), /done requires a PR/)
  assert.equal(parsePlan(fixture.replace('[PR #42](https://github.com/example/project/pull/42)', 'not applicable — local read-only investigation')).valid, true)
  assert.match(messages(fixture.replace('Notes: validation-policy approval is pending', 'Notes: none')), /blocked requires a reason/)
  assert.match(messages(fixture.replace('status: in-progress', 'status: completed')), /unfinished tasks/)
  assert.match(messages(fixture.replace('replaced by T001;', 'replaced by T999;')), /existing replacement task IDs/)
})

test('invalid duplicate headings stay separately navigable without losing source', () => {
  const plan = parsePlan(fixture.replace('## Scope', '## Goal'))
  assert.equal(plan.valid, false)
  assert.equal(new Set(plan.sections.map((section) => section.id)).size, plan.sections.length)
  assert.match(plan.sections[1].markdown, /sample document and a local validation tool/)
})

test('PRs accept multiple GitHub PRs and reject unsafe/non-PR destinations', () => {
  const plan = parsePlan(fixture.replace('[PR #42](https://github.com/example/project/pull/42)', '[First](https://github.com/example/project/pull/42), [Second](https://github.com/example/other/pull/43)'))
  assert.equal(plan.valid, true)
  assert.equal(plan.tasks[3].prs.length, 2)
  for (const url of ['javascript:alert(1)', 'https://github.com.evil.test/a/b/pull/42', 'https://user:secret@github.com/a/b/pull/42', 'https://github.com/a/b/issues/42', 'http://github.com/a/b/pull/42', 'https://github.com:444/a/b/pull/42', 'https://github.com/a/b/pull/0']) {
    assert.equal(pullRequestUrl(url), undefined)
    assert.match(messages(fixture.replace('https://github.com/example/project/pull/42', url)), /PRs must contain/)
  }
  assert.equal(pullRequestUrl('https://github.com/example/project/pull/42/files#diff-a'), 'https://github.com/example/project/pull/42')
})

test('the shared documented template and planner agree with the parser', () => {
  const doc = readFileSync(new URL('../PLAN_FORMAT.md', import.meta.url), 'utf8')
  const template = [...doc.matchAll(/```md\n([\s\S]*?)\n```/g)].map((match) => match[1]).find((text) => text.startsWith('---\n'))
  assert.equal(parsePlan(template).valid, true, messages(template))
  const planner = readFileSync(new URL('../../../agents/planner.md', import.meta.url), 'utf8')
  for (const section of PLAN_SECTIONS) assert.ok(planner.includes(`\`## ${section.title}\``))
  assert.match(planner, /Never overwrite a snapshot/)
  assert.match(planner, /Never start implementation/)
})

test('CLI validates without writing and exits nonzero for missing or nonstandard files', () => {
  const script = new URL('../src/validate.mjs', import.meta.url).pathname
  const path = new URL('./fixtures/sample-plan.md', import.meta.url).pathname
  const result = spawnSync(process.execPath, [script, path], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /valid v1/)
  assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 1)
  assert.equal(spawnSync(process.execPath, [script, `${path}.missing`], { encoding: 'utf8' }).status, 1)
})
