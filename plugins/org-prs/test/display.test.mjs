import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { nextSort, sortPulls, statusColor } from '../src/display.mjs'

const pulls = [
  { number: 20, status: 'Open', updatedAt: '2026-01-01T00:00:00Z', comments: 10 },
  { number: 3, status: 'Draft', updatedAt: '2026-03-01T00:00:00Z', comments: null },
  { number: 11, status: 'Merged', updatedAt: '', comments: 2 },
  { number: 5, status: 'Draft', updatedAt: '2026-02-01T00:00:00Z', comments: 2 },
]
const numbers = (key, direction) => sortPulls(pulls, { key, direction }).map((pr) => pr.number)

test('cycles ascending, descending and the original order, resetting on another column', () => {
  const asc = nextSort(null, 'pull')
  assert.deepEqual(asc, { key: 'pull', direction: 'asc' })
  const desc = nextSort(asc, 'pull')
  assert.deepEqual(desc, { key: 'pull', direction: 'desc' })
  assert.equal(nextSort(desc, 'pull'), null)
  assert.deepEqual(nextSort(desc, 'comments'), { key: 'comments', direction: 'asc' })
  assert.equal(nextSort(desc, 'bad'), desc)
  assert.equal(sortPulls(pulls, null), pulls)
})

test('sorts each column without mutating source, and keeps ties stable', () => {
  assert.deepEqual(numbers('pull', 'asc'), [3, 5, 11, 20])
  assert.deepEqual(numbers('pull', 'desc'), [20, 11, 5, 3])
  assert.deepEqual(numbers('status', 'asc'), [3, 5, 11, 20])
  assert.deepEqual(numbers('status', 'desc'), [20, 11, 3, 5])
  assert.deepEqual(numbers('updated', 'asc'), [20, 5, 3, 11])
  assert.deepEqual(numbers('updated', 'desc'), [3, 5, 20, 11])
  assert.deepEqual(numbers('comments', 'asc'), [11, 5, 20, 3])
  assert.deepEqual(numbers('comments', 'desc'), [20, 11, 5, 3])
  assert.deepEqual(pulls.map((pr) => pr.number), [20, 3, 11, 5])
})

test('gives statuses distinct readable colors for both themes', () => {
  const luminance = (hex) => {
    const parts = hex.match(/[0-9a-f]{2}/gi).map((x) => parseInt(x, 16) / 255)
    const [r, g, b] = parts.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  for (const mode of ['light', 'dark']) {
    const colors = ['Open', 'Draft', 'Merged', 'Closed'].map((status) => statusColor(status, mode))
    assert.equal(new Set(colors).size, 4)
    for (const color of colors) {
      const lum = luminance(color)
      const contrast = mode === 'light' ? 1.05 / (lum + 0.05) : (lum + 0.05) / (luminance('#141414') + 0.05)
      assert.ok(contrast >= 4.5, `${mode} ${color} contrast ${contrast}`)
    }
  }
  assert.equal(statusColor('Unknown', 'dark'), 'inherit')
})
