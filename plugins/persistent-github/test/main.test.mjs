import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { EventEmitter } from 'node:events'

function createHarness() {
  const instances = []
  class Contents extends EventEmitter {
    constructor() { super(); this.closed = false; this.url = ''; this.navigationHistory = { canGoBack: () => false, canGoForward: () => false } }
    setWindowOpenHandler(fn) { this.popup = fn }
    isDestroyed() { return this.closed }
    async loadURL(url) { this.url = url; this.emit('did-navigate') }
    getURL() { return this.url }
    close() { this.closed = true }
    reload() {}
  }
  class View {
    constructor(options) { this.options = options; this.webContents = new Contents(); instances.push(this) }
  }
  const profile = { setPermissionRequestHandler(fn) { this.request = fn }, setPermissionCheckHandler(fn) { this.check = fn } }
  const partitions = []
  const schema = { String: {}, Struct: (shape) => shape }
  const exports = {}
  const modules = {
    'solid-js/web': { template: () => () => {}, delegateEvents: () => {} },
    'solid-js': {},
    effect: { Schema: schema },
    '@opencode/plugin/gui': { Ipc: { define: (spec) => spec }, Plugin: { define: (definition) => definition } },
    electron: { WebContentsView: View, session: { fromPartition(name) { partitions.push(name); return profile } } },
  }
  const source = readFileSync(new URL('../gui-experimental.cjs', import.meta.url), 'utf8')
  runInNewContext(source, { exports, require: (name) => { if (!modules[name]) throw Error(name); return modules[name] }, URL })
  let impl
  const embeds = []
  const ctx = {
    log: { write() {} },
    windows: { get: (window) => ({ id: window, isDestroyed: () => false }), on: () => () => {} },
    embeds: { create: () => { const embed = { id: `view-${embeds.length}`, show(value) { this.visible = value }, dispose() { this.disposed = true } }; embeds.push(embed); return embed } },
    provide: (_contract, methods) => { impl = methods; return { emit() {} } },
  }
  const cleanup = exports.default.main(ctx)
  return { impl, instances, embeds, profile, partitions, cleanup }
}

test('uses one isolated persistent partition, blocks permissions and disposes views', async () => {
  const h = createHarness()
  const caller = { window: 1 }
  const key = '00000000-0000-4000-8000-000000000000'
  assert.equal(h.impl.create(key, caller), 'view-0')
  assert.deepEqual(h.partitions, ['persist:persistent-github'])
  assert.equal(h.instances[0].options.webPreferences.partition, 'persist:persistent-github')
  assert.equal(h.instances[0].options.webPreferences.sandbox, true)
  assert.equal(h.instances[0].options.webPreferences.nodeIntegration, false)
  assert.equal(h.profile.check(), false)
  assert.equal(h.instances[0].webContents.popup().action, 'deny')
  await assert.rejects(h.impl.navigate({ key, url: 'https://example.com/' }, caller))
  await h.impl.navigate({ key, url: 'https://github.com/test/repo' }, caller)
  assert.equal(h.instances[0].webContents.getURL(), 'https://github.com/test/repo')
  h.impl.close(key, caller)
  assert.equal(h.instances[0].webContents.closed, true)
  assert.equal(h.embeds[0].disposed, true)
  h.cleanup()
})

test('prevents untrusted top-level navigation and redirects', () => {
  const h = createHarness()
  h.impl.create('00000000-0000-4000-8000-000000000000', { window: 1 })
  const page = h.instances[0].webContents
  let blocked = false
  page.emit('will-navigate', { preventDefault() { blocked = true } }, { url: 'https://evil.example/' })
  assert.equal(blocked, true)
  blocked = false
  page.emit('will-redirect', { preventDefault() { blocked = true } }, 'https://github.com/login')
  assert.equal(blocked, false)
  h.cleanup()
})
