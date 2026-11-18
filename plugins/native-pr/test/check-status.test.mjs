import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { checkStatus } from '../src/check-status.mjs'

test('renders completed checks and commit statuses with distinct result labels', () => {
  assert.deepEqual(checkStatus({ status: 'completed', conclusion: 'success' }), { tone: 'success', label: 'Passed' })
  assert.deepEqual(checkStatus({ status: 'success' }), { tone: 'success', label: 'Passed' })
  assert.deepEqual(checkStatus({ status: 'completed', conclusion: 'failure' }), { tone: 'failure', label: 'Failed' })
  assert.deepEqual(checkStatus({ status: 'error' }), { tone: 'failure', label: 'Error' })
  assert.deepEqual(checkStatus({ status: 'completed', conclusion: 'timed_out' }), { tone: 'failure', label: 'Timed out' })
  assert.deepEqual(checkStatus({ status: 'completed', conclusion: 'action_required' }), { tone: 'failure', label: 'Action required' })
})

test('distinguishes running, skipped and unavailable checks', () => {
  assert.deepEqual(checkStatus({ status: 'in_progress', conclusion: null }), { tone: 'pending', label: 'In progress' })
  assert.deepEqual(checkStatus({ status: 'queued' }), { tone: 'pending', label: 'Queued' })
  assert.deepEqual(checkStatus({ status: 'pending' }), { tone: 'pending', label: 'Pending' })
  assert.deepEqual(checkStatus({ status: 'completed', conclusion: 'skipped' }), { tone: 'neutral', label: 'Skipped' })
  assert.deepEqual(checkStatus({ status: 'completed', conclusion: 'neutral' }), { tone: 'neutral', label: 'Neutral' })
  assert.deepEqual(checkStatus({ status: 'completed', conclusion: null }), { tone: 'neutral', label: 'Result unavailable' })
  assert.deepEqual(checkStatus({ status: 'future_state' }), { tone: 'neutral', label: 'future state' })
  assert.deepEqual(checkStatus(null), { tone: 'neutral', label: 'Unknown' })
})
