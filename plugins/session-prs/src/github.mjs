import { execFile } from "node:child_process"
import { promisify } from "node:util"

const exec = promisify(execFile)
const options = { timeout: 20000, maxBuffer: 4 * 1024 * 1024 }

export function parseRemote(url) {
  const match = url.trim().match(/^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i)
  return match ? { owner: match[1], repo: match[2] } : null
}

export function checkStatus(checks, statuses) {
  const relevant = checks.filter((check) => !["skipped", "neutral"].includes(check.conclusion))
  if (relevant.some((check) => ["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(check.conclusion)) || statuses.some((status) => ["failure", "error"].includes(status.state))) return "Failed"
  if (relevant.some((check) => check.status !== "completed") || statuses.some((status) => status.state === "pending")) return "Running"
  if (relevant.some((check) => check.conclusion !== "success") || statuses.some((status) => status.state !== "success")) return "Unknown"
  if (relevant.length || statuses.length) return "Passed"
  return "No checks"
}

export function reviewStatus(reviews) {
  const latest = new Map()
  for (const review of reviews) {
    if (review.user?.login && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) latest.set(review.user.login, review.state)
  }
  const states = [...latest.values()]
  if (states.includes("CHANGES_REQUESTED")) return "Changes requested"
  if (states.includes("APPROVED")) return "Approved"
  return "Awaiting review"
}

async function run(command, args, cwd) {
  const { stdout } = await exec(command, args, { ...options, cwd })
  return stdout.trim()
}

export async function identify(directory) {
  const branch = await run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], directory)
  if (["main", "master", "dev", "develop"].includes(branch)) return { branch, shared: true }
  const origin = parseRemote(await run("git", ["config", "--get", "remote.origin.url"], directory))
  if (!origin) throw new Error("The origin remote is not a github.com repository")
  let target = origin
  try {
    const upstream = parseRemote(await run("git", ["config", "--get", "remote.upstream.url"], directory))
    if (upstream) target = upstream
  } catch { /* An upstream remote is optional. */ }
  return { branch, origin, target, shared: false }
}

async function api(path, cwd) {
  return JSON.parse(await run("gh", ["api", "--hostname", "github.com", path], cwd))
}

export function parsePullUrl(url) {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)$/.exec(url)
  if (!match || !Number.isSafeInteger(Number(match[3]))) return null
  return { owner: match[1], repo: match[2], number: Number(match[3]) }
}

export function pullStatus(detail) {
  if (detail.merged_at) return "Merged"
  if (detail.state === "closed") return "Closed"
  if (detail.mergeable === false || detail.mergeable_state === "dirty") return "Conflicts"
  if (detail.draft) return "Draft"
  if (detail.mergeable_state === "blocked" || detail.mergeable_state === "unstable") return "Not ready"
  if (detail.mergeable === null || detail.mergeable_state === "unknown") return "Checking"
  return "Open"
}

export async function readPullById(ref, directory) {
  // All REST paths are explicit. Do not depend on a potentially moved or
  // deleted worktree, or on repository-specific gh configuration.
  directory = undefined
  const root = `repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`
  const detail = await api(`${root}/pulls/${ref.number}`, directory || undefined)
  if (!detail.head?.sha || !detail.head?.ref) throw new Error("PR details are incomplete")
  const [reviews, checks, status] = await Promise.all([
    api(`${root}/pulls/${ref.number}/reviews?per_page=100`, directory || undefined),
    api(`${root}/commits/${detail.head.sha}/check-runs?per_page=100`, directory || undefined),
    api(`${root}/commits/${detail.head.sha}/status?per_page=100`, directory || undefined),
  ])
  return {
    number: ref.number, url: `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`,
    repo: `${ref.owner}/${ref.repo}`, branch: detail.head.ref,
    status: pullStatus(detail), ci: checkStatus(checks.check_runs, status.statuses),
    review: reviewStatus(reviews), comments: (detail.comments || 0) + (detail.review_comments || 0),
  }
}

export async function readPull(info, directory, readById = readPullById) {
  if (info.shared) return { branch: info.branch, note: "Shared branch — no PR matched" }
  const { owner, repo } = info.target
  const root = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  const query = new URLSearchParams({ state: "all", head: `${info.origin.owner}:${info.branch}`, per_page: "10" })
  const pulls = await api(`${root}/pulls?${query}`, directory)
  const matches = pulls.filter((item) => item.head?.repo?.full_name?.toLowerCase() === `${info.origin.owner}/${info.origin.repo}`.toLowerCase())
  const pull = matches.find((item) => item.state === "open") || matches[0]
  if (!pull) return { branch: info.branch, note: "No PR yet" }
  return {
    branch: info.branch,
    pr: await readById({ owner, repo, number: pull.number }, directory),
  }
}

// PR-specific cache deduplicates references shared by chats and branches.
export function makePullReader({ readFn = readPullById, now = Date.now, ttl = 60000 } = {}) {
  const cache = new Map()
  return async (url, directory) => {
    const ref = parsePullUrl(url)
    if (!ref) throw new Error("Invalid pull request URL")
    const key = `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}#${ref.number}`
    const existing = cache.get(key)
    if (existing && now() - existing.time < ttl) return existing.promise
    const promise = readFn(ref, directory)
    cache.set(key, { time: now(), promise })
    return promise
  }
}

export async function readReferencedPulls(urls, read, directory, concurrency = 4) {
  const results = new Array(urls.length)
  let next = 0
  async function worker() {
    while (next < urls.length) {
      const index = next++
      const url = urls[index]
      try { results[index] = await read(url, directory) }
      catch {
        const ref = parsePullUrl(url)
        if (ref) results[index] = { ...ref, repo: `${ref.owner}/${ref.repo}`, url, status: "Unavailable", ci: "Unknown", review: "Unknown", comments: null }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker))
  return results.filter(Boolean)
}

// Shared by all windows. Even manual refreshes cannot repeatedly query GitHub.
export function makeReader({ identifyFn = identify, readFn = readPull, now = Date.now, ttl = 60000 } = {}) {
  const cache = new Map()
  return async (directory) => {
    const info = await identifyFn(directory)
    if (info.shared) return { data: await readFn(info, directory), cached: false, checkedAt: now() }
    const key = `${info.target.owner.toLowerCase()}/${info.target.repo.toLowerCase()}:${info.origin.owner.toLowerCase()}/${(info.origin.repo || "").toLowerCase()}:${info.branch}`
    const existing = cache.get(key)
    if (existing && now() - existing.time < ttl) return { data: await existing.promise, cached: true, checkedAt: existing.time }
    const promise = readFn(info, directory)
    const checkedAt = now()
    cache.set(key, { time: checkedAt, promise })
    return { data: await promise, cached: false, checkedAt }
  }
}
