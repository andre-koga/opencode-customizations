import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { confirmPrimaryAction } from '../src/confirmation.mjs'

test('marking a draft ready does not show a confirmation dialog', async () => {
  const confirm = () => { throw new Error('Unexpected confirmation') }
  assert.equal(await confirmPrimaryAction('draft', {}, confirm), true)
  assert.equal(await confirmPrimaryAction('blocked', {}, confirm), false)
})

test('merge requires explicit confirmation and respects cancellation', async () => {
  const current = { ref: { owner: 'acme', repo: 'repo', number: 42 }, pull: { base: 'dev' } }
  let dialog
  const confirm = async (options) => { dialog = options; return false }
  assert.equal(await confirmPrimaryAction('ready', current, confirm), false)
  assert.equal(dialog.danger, true)
  assert.match(dialog.description, /acme\/repo #42 into dev/)
  assert.equal(await confirmPrimaryAction('ready', current, async () => true), true)
})
