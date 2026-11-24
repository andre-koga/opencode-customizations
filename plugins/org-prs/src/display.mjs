import { statusColor as sharedStatusColor } from '../../shared-ui/status.mjs'
const columns = new Set(['pull', 'status', 'updated', 'comments'])

/** Cycle one column through ascending, descending and the original order. */
export function nextSort(current, key) {
  if (!columns.has(key)) return current
  if (!current || current.key !== key) return { key, direction: 'asc' }
  return current.direction === 'asc' ? { key, direction: 'desc' } : null
}

/** Sort a copy, preserve the server order for ties, and keep missing values last. */
export function sortPulls(pulls, sort) {
  if (!sort || !columns.has(sort.key) || !['asc', 'desc'].includes(sort.direction)) return pulls
  const value = (pr) => {
    if (sort.key === 'pull') return Number.isSafeInteger(pr.number) ? pr.number : null
    if (sort.key === 'status') return typeof pr.status === 'string' && pr.status ? pr.status : null
    if (sort.key === 'comments') return Number.isSafeInteger(pr.comments) && pr.comments >= 0 ? pr.comments : null
    const time = typeof pr.updatedAt === 'string' && pr.updatedAt ? Date.parse(pr.updatedAt) : NaN
    return Number.isFinite(time) ? time : null
  }
  const direction = sort.direction === 'asc' ? 1 : -1
  return pulls.map((pr, index) => ({ pr, index, value: value(pr) })).sort((a, b) => {
    if (a.value === null || b.value === null) return a.value === b.value ? a.index - b.index : a.value === null ? 1 : -1
    const comparison = typeof a.value === 'string' ? a.value.localeCompare(b.value, undefined, { sensitivity: 'base' }) : a.value - b.value
    return comparison === 0 ? a.index - b.index : direction * comparison
  }).map((item) => item.pr)
}

/** Statuses keep their names as well as distinct, theme-appropriate colors. */
export function statusColor(status, mode) {
  return sharedStatusColor(status, mode)
}
