import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

test('registers a native panel and routes a validated PR into its session', () => {
  const exports = {}
  const plugin = {
    Contract: { define: (id) => ({ id }) },
    Ipc: { define: (spec) => spec },
    Panel: Symbol('panel'),
    Plugin: { define: (definition) => definition },
  }
  const modules = {
    'solid-js/web': { template: () => () => {}, delegateEvents() {} },
    'solid-js': {},
    effect: { Schema: { String: {}, Unknown: {}, Struct: (shape) => shape } },
    '@opencode/plugin/gui': plugin,
    'node:child_process': { execFile() {} },
    'node:util': { promisify: () => async () => ({ stdout: '{}' }) },
  }
  runInNewContext(readFileSync(new URL('../gui-experimental.cjs', import.meta.url), 'utf8'), {
    exports, require: (name) => { if (!modules[name]) throw Error(name); return modules[name] }, URL, encodeURIComponent, decodeURIComponent,
  })
  let navigation, panel
  const opened = []
  exports.default.setup({
    id: 'native-pr',
    main: () => ({}),
    provide: (_token, implementation) => { navigation = implementation },
    add: (_registry, item) => { panel = item },
    layout: { open: (key, session) => opened.push({ key, session }) },
  })
  const session = { id: 'test-session' }
  assert.equal(navigation.open(session, 'https://github.com/acme/repo/pull/42/files'), true)
  assert.equal(navigation.open(session, 'https://evil.test/acme/repo/pull/42'), false)
  assert.equal(opened.length, 1)
  assert.equal(opened[0].session, session)
  const id = opened[0].key.slice('native-pr:'.length)
  assert.equal(decodeURIComponent(id), 'https://github.com/acme/repo/pull/42')
  const listed = panel.list({ open: [id] })
  assert.equal(listed.length, 1)
  assert.equal(listed[0].title, 'repo #42')
})

test('window and main register the same versioned IPC with read and action methods', async () => {
  const exports = {}
  const plugin = {
    Contract: { define: (id) => ({ id }) },
    Ipc: { define: (spec) => spec },
    Panel: Symbol('panel'),
    Plugin: { define: (definition) => definition },
  }
  const modules = {
    'solid-js/web': { template: () => () => {}, delegateEvents() {} },
    'solid-js': {},
    effect: { Schema: { String: {}, Unknown: {}, Struct: (shape) => shape } },
    '@opencode/plugin/gui': plugin,
    'node:child_process': { execFile() {} },
    'node:util': { promisify: () => async () => ({ stdout: '{}' }) },
  }
  runInNewContext(readFileSync(new URL('../gui-experimental.cjs', import.meta.url), 'utf8'), {
    exports, require: (name) => { if (!modules[name]) throw Error(name); return modules[name] }, URL, encodeURIComponent, decodeURIComponent,
  })
  let clientSpec, providerSpec, implementation
  exports.default.setup({
    main: (spec) => { clientSpec = spec; return {} },
    provide() {},
    add() {},
  })
  exports.default.main({
    provide: (spec, impl) => { providerSpec = spec; implementation = impl },
    log: { write() {} },
  })
  assert.equal(clientSpec, providerSpec)
  assert.equal(clientSpec.id, 'native-pr.backend-v2')
  assert.deepEqual(Object.keys(clientSpec.methods).sort(), ['action', 'read'])
  assert.equal(typeof implementation.read, 'function')
  assert.equal(typeof implementation.action, 'function')
  await assert.rejects(implementation.action({ url: 'invalid', action: 'ready', expectedHead: 'a'.repeat(40) }), /Invalid pull request/)
})
