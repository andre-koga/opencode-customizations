export function statusColor(value) {
  if (["Passed", "Approved", "Merged"].includes(value)) return "var(--text-success, #16834a)"
  if (["Failed", "Changes requested", "Not ready", "Unavailable"].includes(value)) return "var(--text-critical, #dc2626)"
  if (["Conflicts", "Running"].includes(value)) return "var(--text-warning, #b77900)"
  return "var(--text-weak, #888)"
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
