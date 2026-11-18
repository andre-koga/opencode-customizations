import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { formatUpdatedTime } from '../src/updated-time.mjs'

test('formats GitHub update time as a relative age and local date', () => {
  const now = Date.parse('2026-11-18T18:00:00Z')
  const result = formatUpdatedTime('2026-11-10T18:00:00Z', now)
  assert.equal(result.relative, '8 days ago')
  assert.equal(result.absolute, new Date('2026-11-10T18:00:00Z').toLocaleString())
  assert.equal(formatUpdatedTime('2026-11-18T17:58:00Z', now).relative, '2 minutes ago')
  assert.equal(formatUpdatedTime('2026-11-18T18:00:30Z', now).relative, 'just now')
  assert.equal(formatUpdatedTime('2026-11-20T18:00:00Z', now).relative, 'in 2 days')
})

test('does not invent an update time when GitHub returns missing or invalid data', () => {
  for (const value of ['', null, undefined, 'invalid']) assert.equal(formatUpdatedTime(value), null)
})
