import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { openPullRequest } from '../src/navigation.mjs'

test('opens the native viewer before falling back to either browser', () => {
  const session = { id: 'one' }, url = 'https://github.com/acme/repo/pull/1', calls = []
  const native = { status: 'active', value: { open: (s, u) => { calls.push(['native', s, u]); return true } } }
  const browser = { status: 'active', value: { canOpen: () => true, open: (s, u) => calls.push(['browser', s, u]) } }
  const external = (u) => calls.push(['external', u])
  assert.equal(openPullRequest({ session, url, native, browser, external }), 'native')
  assert.equal(calls.length, 1)
  assert.equal(openPullRequest({ session, url, native: { status: 'inactive' }, browser, external }), 'browser')
  assert.equal(openPullRequest({ session, url, native: { status: 'inactive' }, browser: { status: 'inactive' }, external }), 'external')
  assert.deepEqual(calls.map((call) => call[0]), ['native', 'browser', 'external'])
})
