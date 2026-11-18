/** Presentation only; merge eligibility is still decided by primaryAction. */
export function checkStatus(check) {
  const value = typeof check?.conclusion === 'string' && check.conclusion
    ? check.conclusion.toLowerCase()
    : typeof check?.status === 'string' ? check.status.toLowerCase() : ''
  const states = {
    success: ['success', 'Passed'],
    failure: ['failure', 'Failed'],
    error: ['failure', 'Error'],
    timed_out: ['failure', 'Timed out'],
    cancelled: ['failure', 'Cancelled'],
    startup_failure: ['failure', 'Startup failed'],
    action_required: ['failure', 'Action required'],
    stale: ['failure', 'Stale'],
    in_progress: ['pending', 'In progress'],
    pending: ['pending', 'Pending'],
    queued: ['pending', 'Queued'],
    waiting: ['pending', 'Waiting'],
    requested: ['pending', 'Requested'],
    expected: ['pending', 'Expected'],
    skipped: ['neutral', 'Skipped'],
    neutral: ['neutral', 'Neutral'],
    completed: ['neutral', 'Result unavailable'],
  }
  const [tone, label] = states[value] || ['neutral', value ? value.replaceAll('_', ' ') : 'Unknown']
  return { tone, label }
}
