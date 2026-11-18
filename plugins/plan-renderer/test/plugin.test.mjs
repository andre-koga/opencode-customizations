import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

test('registers a scoped plan link handler, command, and side panel', async () => {
  const exports = {}
  const api = { Plugin: { define: (value) => value }, Panel: Symbol('panel'), Command: Symbol('command'), LinkHandler: Symbol('link') }
  const modules = {
    '@opencode/plugin/gui': api,
    'solid-js/web': { template: () => () => {}, delegateEvents() {} },
    'solid-js': {},
  }
  runInNewContext(readFileSync(new URL('../gui-experimental.cjs', import.meta.url), 'utf8'), {
    exports, require: (name) => { if (!modules[name]) throw Error(name); return modules[name] }, encodeURIComponent, decodeURIComponent,
  })
  const session = { id: 's1', key: 'server\ns1' }
  const file = { resolve: (path) => path, absolute: (path) => path.startsWith('/'), exists: async () => true }
  const entries = new Map(), opened = []
  exports.default.setup({
    id: 'plan-renderer',
    sessions: { current: () => session },
    screen: { current: () => ({ file }) },
    add: (registry, value) => entries.set(registry, value),
    layout: { open: (...args) => opened.push(args) },
  })
  const links = entries.get(api.LinkHandler)
  const link = { session, href: '.opencode/plans/example.md', background: true }
  assert.equal(links.match(link), true)
  assert.equal(links.match({ ...link, href: 'README.md' }), false)
  assert.equal(links.match({ ...link, session: { key: 'other' } }), false)
  assert.equal(await links.exists(link), true)
  links.open(link)
  assert.equal(opened[0][0], `plan-renderer:${encodeURIComponent(link.href)}`)
  assert.equal(opened[0][1], session)
  assert.equal(opened[0][2].background, true)
  const panel = entries.get(api.Panel)
  const tab = panel.list({ open: [encodeURIComponent(link.href)] })[0]
  assert.equal(tab.file, link.href)
  assert.equal(tab.title, 'example.md')
  assert.equal(entries.get(api.Command)().title, 'Open plan renderer')
})
