import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const ttl = 60_000

/** Only exact GitHub PR links are accepted; no arbitrary command arguments or hosts. */
export function parsePullUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password) return null
    const match = /^\/([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\/([a-z0-9_.-]{1,100})\/pull\/([1-9][0-9]{0,8})(?:\/.*)?$/i.exec(url.pathname)
    if (!match || match[2] === '.' || match[2] === '..') return null
    const [, owner, repo, number] = match
    return { owner, repo, number: Number(number), url: `https://github.com/${owner}/${repo}/pull/${number}` }
  } catch { return null }
}

export async function ghApi(path) {
  const { stdout } = await exec('gh', ['api', '--hostname', 'github.com', path], { timeout: 20000, maxBuffer: 12 * 1024 * 1024 })
  return JSON.parse(stdout)
}

/** Conservative state: never offer merging while GitHub's answer is incomplete. */
export function primaryAction(data) {
  const p = data?.pull
  if (!p || p.state === 'Merged' || p.state === 'Closed') return { kind: 'closed', label: p?.state || 'Unavailable' }
  if (p.state === 'Draft') return { kind: 'draft', label: 'Mark ready for review' }
  if (p.mergeable === false || p.mergeableState === 'dirty') return { kind: 'conflict', label: 'Ask agent to fix conflicts' }
  if (p.mergeable !== true || !p.mergeableState || p.mergeableState === 'unknown') return { kind: 'unknown', label: 'Checking mergeability' }
  if (data.checks === null || data.statuses === null || data.reviews === null || data.limited.some((x) => ['checks', 'statuses', 'reviews'].includes(x))) return { kind: 'unknown', label: 'Status unavailable' }

  // Combined statuses are newest first; an old failed run is not the current status.
  const statuses = new Map()
  for (const status of data.statuses) if (!statuses.has(status.name)) statuses.set(status.name, status.status)
  const decisions = new Map()
  for (const review of data.reviews) if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) decisions.set(review.author, review.state)
  const failed = data.checks.some((check) => ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale'].includes(check.conclusion)) || [...statuses.values()].some((state) => ['failure', 'error'].includes(state))
  if (failed || [...decisions.values()].includes('CHANGES_REQUESTED')) return { kind: 'blocked', label: 'Ask agent to fix issues' }
  if (data.checks.some((check) => check.status !== 'completed') || [...statuses.values()].some((state) => ['pending', 'expected'].includes(state))) return { kind: 'pending', label: 'Checks running' }
  if (data.checks.some((check) => !['success', 'neutral', 'skipped'].includes(check.conclusion)) || [...statuses.values()].some((state) => state !== 'success')) return { kind: 'unknown', label: 'Status unavailable' }
  if (p.mergeableState !== 'clean') return { kind: 'blocked', label: 'Ask agent to fix issues' }
  return { kind: 'ready', label: 'Merge pull request' }
}

/** Run only after the person explicitly confirms the action in the UI. */
export async function applyGithubAction({ url, action, expectedHead }, { read = readPull, run = exec } = {}) {
  const ref = parsePullUrl(url)
  if (!ref || !/^[0-9a-f]{40}$/i.test(expectedHead)) throw new Error('Invalid pull request or commit.')
  if (!['ready', 'merge'].includes(action)) throw new Error('Unsupported action.')
  const fresh = await read(ref.url)
  if (fresh.pull.sha !== expectedHead) throw new Error('The pull request changed. Refresh and review the new commit before continuing.')
  const state = primaryAction(fresh).kind
  if (action === 'ready' && state !== 'draft') throw new Error('The pull request is no longer a draft. Refresh and try again.')
  if (action === 'merge' && state !== 'ready') throw new Error('The pull request is no longer ready to merge. Refresh and check its status.')
  try {
    if (action === 'ready') {
      await run('gh', ['pr', 'ready', String(ref.number), '--repo', `${ref.owner}/${ref.repo}`], { timeout: 30000, maxBuffer: 1024 * 1024 })
    } else {
      const path = `repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pulls/${ref.number}/merge`
      const { stdout } = await run('gh', ['api', '--hostname', 'github.com', '--method', 'PUT', path, '-f', `sha=${expectedHead}`, '-f', 'merge_method=merge'], { timeout: 30000, maxBuffer: 1024 * 1024 })
      if (!JSON.parse(stdout).merged) throw new Error('GitHub did not report a successful merge.')
    }
  } catch {
    throw new Error(action === 'merge' ? 'GitHub did not merge the PR. Check permissions, branch protection, and whether merge commits are allowed.' : 'GitHub did not mark the PR ready. Check permissions and try again.')
  }
}

/** Independent sections can fail without making other information disappear. */
export async function readPull(url, api = ghApi) {
  const ref = parsePullUrl(url)
  if (!ref) throw new Error('Enter a valid github.com pull request URL.')
  const root = `repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`
  let pull
  try { pull = await api(`${root}/pulls/${ref.number}`) }
  catch { throw new Error('Could not load the pull request. Check gh authentication and repository access.') }
  if (!/^[0-9a-f]{40}$/i.test(pull.head?.sha ?? '')) throw new Error('GitHub returned an invalid pull request head.')
  const paths = {
    reviews: `${root}/pulls/${ref.number}/reviews?per_page=100`,
    comments: `${root}/issues/${ref.number}/comments?per_page=100`,
    inline: `${root}/pulls/${ref.number}/comments?per_page=100`,
    files: `${root}/pulls/${ref.number}/files?per_page=100`,
    checks: `${root}/commits/${pull.head.sha}/check-runs?per_page=100`,
    statuses: `${root}/commits/${pull.head.sha}/status?per_page=100`,
  }
  const entries = await Promise.all(Object.entries(paths).map(async ([name, path]) => {
    try { return [name, { data: await api(path), error: false }] }
    catch { return [name, { data: null, error: true }] }
  }))
  const parts = Object.fromEntries(entries)
  return {
    ref,
    pull: { title: pull.title, body: pull.body || '', state: pull.merged_at ? 'Merged' : pull.state === 'closed' ? 'Closed' : pull.draft ? 'Draft' : 'Open', author: pull.user?.login || 'Unknown', base: pull.base?.ref || '', head: pull.head?.ref || '', sha: pull.head.sha, mergeable: pull.mergeable ?? null, mergeableState: pull.mergeable_state || 'unknown', additions: pull.additions ?? 0, deletions: pull.deletions ?? 0, changedFiles: pull.changed_files ?? 0, updatedAt: pull.updated_at || '', url: ref.url },
    reviews: parts.reviews.error ? null : (parts.reviews.data ?? []).map((r) => ({ id: r.id, author: r.user?.login || 'Unknown', state: r.state, body: r.body || '', date: r.submitted_at || '' })),
    comments: parts.comments.error ? null : (parts.comments.data ?? []).map((c) => ({ id: c.id, author: c.user?.login || 'Unknown', body: c.body || '', date: c.created_at || '' })),
    inline: parts.inline.error ? null : (parts.inline.data ?? []).map((c) => ({ id: c.id, author: c.user?.login || 'Unknown', body: c.body || '', date: c.created_at || '', path: c.path || '', line: c.line ?? c.original_line ?? null, diff: c.diff_hunk || '' })),
    files: parts.files.error ? null : (parts.files.data ?? []).map((f) => ({ name: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch ?? null })),
    checks: parts.checks.error ? null : (parts.checks.data?.check_runs ?? []).map((c) => ({ id: c.id, name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url || '' })),
    statuses: parts.statuses.error ? null : (parts.statuses.data?.statuses ?? []).map((s) => ({ id: s.id, name: s.context, status: s.state, description: s.description || '', url: s.target_url || '' })),
    limited: [
      ...['reviews', 'comments', 'inline', 'files'].filter((key) => Array.isArray(parts[key].data) && parts[key].data.length === 100),
      ...(parts.checks.data?.total_count > 100 ? ['checks'] : []),
      ...(parts.statuses.data?.total_count > 100 ? ['statuses'] : []),
    ],
  }
}

/** Cache only successful reads, share concurrent requests, and never poll. */
export function makeReader({ read = readPull, now = Date.now } = {}) {
  const cache = new Map()
  const reader = async (url) => {
    const ref = parsePullUrl(url)
    if (!ref) throw new Error('Enter a valid github.com pull request URL.')
    const key = ref.url.toLowerCase()
    const old = cache.get(key)
    if (old && now() - old.time < ttl) return { data: await old.promise, cached: true, checkedAt: old.time }
    const entry = { time: now(), promise: null }
    entry.promise = read(ref.url).catch((error) => { if (cache.get(key) === entry) cache.delete(key); throw error })
    cache.set(key, entry)
    return { data: await entry.promise, cached: false, checkedAt: entry.time }
  }
  reader.invalidate = (url) => { const ref = parsePullUrl(url); if (ref) cache.delete(ref.url.toLowerCase()) }
  return reader
}
