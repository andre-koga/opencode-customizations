import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

test('registers a session panel and its native-viewer contract', () => {
  const exports = {}, panel = Symbol('panel'), command = Symbol('command'), menu = Symbol('menu')
  const gui = { Plugin: { define: (value) => value }, Panel: panel, Command: command, MenuItem: menu, Contract: { define: (id) => ({ id }) }, Ipc: { define: (spec) => spec } }
  const modules = {
    '@opencode/plugin/gui': gui,
    '@opencode/plugin/gui/browser': { Browser: { id: 'browser' } },
    effect: { Schema: { String: {}, Unknown: {}, Struct: (shape) => shape } },
    'solid-js': { createSignal: (value) => [() => value, () => {}] }, 'solid-js/web': { template: () => () => {}, delegateEvents() {} },
    'node:child_process': { execFile() {} }, 'node:util': { promisify: () => async () => ({ stdout: '{}' }) },
  }
  runInNewContext(readFileSync(new URL('../gui-experimental.cjs', import.meta.url), 'utf8'), {
    exports, require: (name) => { if (!modules[name]) throw Error(name); return modules[name] }, URL, URLSearchParams,
  })
  const session = { id: 'one' }, entries = new Map(), opened = [], contracts = []
  exports.default.setup({
    id: 'org-prs', options: {}, main: () => ({}), use: (token) => { contracts.push(token.id); return () => ({ status: 'inactive' }) },
    sessions: { current: () => session }, add: (registry, value) => entries.set(registry, value),
    layout: { open: (key, selected) => opened.push([key, selected]) },
  })
  assert.ok(contracts.includes('native-pr.open'))
  const pinned = entries.get(panel).list({ open: [] })[0]
  assert.equal(pinned.title, 'My organization PRs')
  assert.equal(pinned.pinned, true)
  assert.equal(entries.get(panel).list({ open: ['main'] })[0], pinned)
  entries.get(command)().run()
  assert.deepEqual(opened, [['org-prs:main', session]])
  assert.equal(entries.get(menu)().title, 'My organization PRs')
})
