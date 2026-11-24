import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findingsStatus, palette, statusColor, statusLabel, statusTone } from './status.mjs'
import { statusColor as orgColor } from '../org-prs/src/display.mjs'
import { statusColor as sessionColor } from '../session-prs/src/display.mjs'

test('semantic colors are shared across all consumers', () => {
  for (const value of ['Open', 'Merged', 'Draft', 'Ready', 'Failed', 'Conflicts', 'Running', 'Unknown', 'Unavailable']) {
    assert.equal(orgColor(value, 'dark'), palette.dark[statusTone(value)])
    assert.equal(sessionColor(value), statusColor(value))
  }
  for (const value of ['Merged', 'done', 'completed']) assert.equal(statusTone(value), 'completed')
  for (const value of ['Ready', 'Passed', 'Approved']) assert.equal(statusTone(value), 'success')
  for (const value of ['Failed', 'Blocked', 'Conflicts']) assert.equal(statusTone(value), 'critical')
  for (const value of ['Running', 'in_progress', 'Outdated']) assert.equal(statusTone(value), 'warning')
  for (const value of ['Unavailable', 'Unknown', 'Draft', 'Closed', 'cancelled']) assert.equal(statusTone(value), 'weak')
})

test('status labels are readable while internal values stay untouched', () => {
  assert.equal(statusLabel('done'), 'Completed')
  assert.equal(statusLabel('todo'), 'To do')
  assert.equal(statusLabel('in_progress'), 'In progress')
  assert.equal(statusLabel('changes_requested'), 'Changes requested')
  assert.equal(statusLabel('APPROVED'), 'Approved')
  assert.equal(statusLabel('Running'), 'In progress')
  assert.equal(statusLabel(null), 'Unknown')
})

test('only current, known zero findings are successful', () => {
  assert.deepEqual(findingsStatus({ count: 0 }), { tone: 'success', label: '0' })
  assert.deepEqual(findingsStatus({ count: 3 }), { tone: 'critical', label: '3' })
  assert.deepEqual(findingsStatus({ count: 0, outdated: true }), { tone: 'warning', label: '0 · Outdated' })
  assert.equal(findingsStatus(null).tone, 'weak')
  assert.equal(findingsStatus({ count: '?' }).tone, 'weak')
})

test('all semantic text colors meet 4.5:1 contrast in the supported default themes', () => {
  const luminance = (hex) => {
    const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map(x => parseInt(x, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    return .2126 * r + .7152 * g + .0722 * b
  }
  for (const mode of ['light', 'dark']) for (const [tone, color] of Object.entries(palette[mode])) {
    const bg = luminance(mode === 'light' ? '#ffffff' : '#141414'), fg = luminance(color)
    const ratio = (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05)
    assert.ok(ratio >= 4.5, `${mode} ${tone}: ${ratio}`)
  }
})
