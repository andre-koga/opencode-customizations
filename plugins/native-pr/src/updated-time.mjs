/** GitHub's updated_at includes PR activity, not just code changes. */
export function formatUpdatedTime(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  const time = date.getTime()
  if (!Number.isFinite(time) || !Number.isFinite(now)) return null

  const elapsed = time - now
  const magnitude = Math.abs(elapsed)
  const units = [
    ['year', 365 * 24 * 60 * 60 * 1000],
    ['month', 30 * 24 * 60 * 60 * 1000],
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000],
  ]
  const unit = units.find(([, size]) => magnitude >= size)
  const relative = unit
    ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.trunc(elapsed / unit[1]), unit[0])
    : 'just now'
  return { relative, absolute: date.toLocaleString() }
}
