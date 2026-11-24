export { statusColor } from '../../shared-ui/status.mjs'

export function visiblePulls(pulls, hideMerged) {
  return hideMerged ? pulls.filter((pr) => pr.status !== "Merged") : pulls
}

export function combinePulls(branchPull, referenced) {
  const pulls = new Map()
  for (const pr of [branchPull, ...referenced]) {
    if (!pr) continue
    const key = `${pr.repo.toLowerCase()}#${pr.number}`
    const existing = pulls.get(key)
    if (!existing || (existing.status === "Unavailable" && pr.status !== "Unavailable")) pulls.set(key, pr)
  }
  return [...pulls.values()]
}
