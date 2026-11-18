import test from "node:test"
import assert from "node:assert/strict"
import { checkStatus, makeReader, makePullReader, parsePullUrl, parseRemote, pullStatus, readPullById, readReferencedPulls, reviewFindings, reviewStatus } from "../src/github.mjs"

test("accepts GitHub remotes and rejects other hosts", () => {
  assert.deepEqual(parseRemote("git@github.com:example-org/example-repo.git"), { owner: "example-org", repo: "example-repo" })
  assert.deepEqual(parseRemote("https://github.com/example-org/example-repo"), { owner: "example-org", repo: "example-repo" })
  assert.deepEqual(parseRemote("ssh://git@github.com/example-org/example-repo.git"), { owner: "example-org", repo: "example-repo" })
  assert.equal(parseRemote("https://github.com.evil.test/example-org/example-repo"), null)
  assert.equal(parseRemote("https://example.com/example-org/example-repo"), null)
})

test("summarizes checks without treating skipped checks as success", () => {
  assert.equal(checkStatus([], []), "No checks")
  assert.equal(checkStatus([{ status: "completed", conclusion: "skipped" }], []), "No checks")
  assert.equal(checkStatus([{ status: "in_progress", conclusion: null }], []), "Running")
  assert.equal(checkStatus([{ status: "completed", conclusion: "failure" }], []), "Failed")
  assert.equal(checkStatus([{ status: "completed", conclusion: "success" }], []), "Passed")
  assert.equal(checkStatus([], [{ state: "error" }]), "Failed")
  assert.equal(checkStatus([], [{ state: "pending" }]), "Running")
  assert.equal(checkStatus([{ status: "completed", conclusion: "stale" }], []), "Unknown")
})

test("gives each PR its actual state, including conflicts and blocked readiness", () => {
  assert.equal(pullStatus({ state: "open", draft: true, mergeable: true }), "Draft")
  assert.equal(pullStatus({ state: "open", draft: true, mergeable: false }), "Conflicts")
  assert.equal(pullStatus({ state: "open", mergeable: true, mergeable_state: "blocked" }), "Not ready")
  assert.equal(pullStatus({ state: "open", mergeable: null }), "Checking")
  assert.equal(pullStatus({ state: "open", mergeable: true }), "Open")
  assert.equal(pullStatus({ state: "closed", merged_at: "now" }), "Merged")
  assert.equal(pullStatus({ state: "closed" }), "Closed")
})

test("accepts only canonical pull URLs", () => {
  assert.deepEqual(parsePullUrl("https://github.com/org/repo/pull/123"), { owner: "org", repo: "repo", number: 123 })
  for (const value of ["https://github.com.evil/org/repo/pull/123", "https://github.com/org/repo/issues/123", "https://github.com/org/repo/pull/1?token=x", "https://github.com/org/repo/pull/9007199254740992"]) assert.equal(parsePullUrl(value), null)
})

test("includes the PR title from GitHub details without additional requests", async () => {
  const paths = []
  const fetch = async (path) => {
    paths.push(path)
    if (path === "repos/org/repo/pulls/123") return { title: "Improve checkout", comments: 1, state: "open", mergeable: true, head: { sha: "abc", ref: "feature" } }
    if (path.includes("/issues/123/comments?")) return []
    if (path.includes("/check-runs?")) return { check_runs: [] }
    if (path.includes("/status?")) return { statuses: [] }
    throw new Error("Unexpected request")
  }
  const pr = await readPullById({ owner: "org", repo: "repo", number: 123 }, undefined, fetch)
  assert.equal(pr.title, "Improve checkout")
  assert.equal(pr.repo, "org/repo")
  assert.equal(pr.number, 123)
  assert.equal(paths.length, 4)
})

test("uses the latest bot review marker and flags findings from an old commit", () => {
  const head = "a".repeat(40)
  const marker = (sha, count) => `<!-- review-done sha=${sha} findings=${count} -->`
  const comments = [
    { user: { login: "github-actions[bot]" }, created_at: "2026-01-02", body: marker(head, 5) },
    { user: { login: "github-actions[bot]" }, created_at: "2026-01-01", body: marker("b".repeat(40), 2) },
    { user: { login: "someone" }, created_at: "2026-01-03", body: marker(head, 99) },
  ]
  assert.deepEqual(reviewFindings(comments, head), { count: "5", outdated: false })
  assert.deepEqual(reviewFindings(comments, "b".repeat(40)), { count: "5", outdated: true })
  assert.equal(reviewFindings([], head), null)
  assert.equal(reviewFindings(null, head), null)
  assert.equal(reviewFindings(comments, "invalid"), null)
  assert.deepEqual(reviewFindings([{ user: { login: "github-actions[bot]" }, body: marker(head, 0) }], head), { count: "0", outdated: false })
})

test("latest open count supersedes old findings, while malformed markers are unknown", () => {
  const head = "a".repeat(40), old = "b".repeat(40)
  const comments = [
    { user: { login: "github-actions[bot]" }, created_at: "2026-01-01", body: `<!-- review-done sha=${old} findings=5 -->` },
    { user: { login: "github-actions[bot]" }, created_at: "2026-01-02", body: `<!-- review-done sha=${head} open=0 -->` },
  ]
  assert.deepEqual(reviewFindings(comments, head), { count: "0", outdated: false })
  assert.deepEqual(reviewFindings([{ user: { login: "github-actions[bot]" }, body: `<!-- review-done findings=5 open=0 sha=${head} -->` }], head), { count: "0", outdated: false })
  assert.equal(reviewFindings([...comments, { user: { login: "github-actions[bot]" }, created_at: "2026-01-03", body: `<!-- review-done sha=${head} open=bad -->` }], head), null)
  assert.equal(reviewFindings([{ user: { login: "github-actions[bot]" }, body: `<!-- review-done sha=${head} open=0 open=2 -->` }], head), null)
})

test("only marks zero-findings PRs ready when GitHub and checks are clear", () => {
  const clean = { state: "open", mergeable: true, mergeable_state: "clean" }
  const findings = { count: "0", outdated: false }
  assert.equal(pullStatus(clean, { ci: "Passed", findings }), "Ready")
  assert.equal(pullStatus(clean, { ci: "Running", findings }), "Open")
  assert.equal(pullStatus(clean, { ci: "Failed", findings }), "Open")
  assert.equal(pullStatus(clean, { ci: "Passed", findings: { count: "0", outdated: true } }), "Open")
  assert.equal(pullStatus({ ...clean, mergeable_state: "blocked" }, { ci: "Passed", findings }), "Not ready")
  assert.equal(pullStatus(clean, { ci: "Passed", findings: null }), "Open")
})

test("loads the most recent issue-comment page and tolerates a comments API error", async () => {
  const head = "a".repeat(40)
  const paths = []
  let fail = false
  const fetch = async (path) => {
    paths.push(path)
    if (path === "repos/org/repo/pulls/123") return { comments: 101, state: "open", mergeable: true, head: { sha: head, ref: "feature" } }
    if (path.includes("/check-runs?")) return { check_runs: [] }
    if (path.includes("/status?")) return { statuses: [] }
    if (path.includes("/issues/123/comments?")) {
      if (fail) throw new Error("Comments unavailable")
      return [{ user: { login: "github-actions[bot]" }, body: `<!-- review-done sha=${head} findings=3 -->` }]
    }
    throw new Error("Unexpected request")
  }
  const ref = { owner: "org", repo: "repo", number: 123 }
  const pr = await readPullById(ref, undefined, fetch)
  assert.deepEqual(pr.findings, { count: "3", outdated: false })
  assert.ok(paths.includes("repos/org/repo/issues/123/comments?per_page=100&page=2"))
  fail = true
  assert.equal((await readPullById(ref, undefined, fetch)).findings, null)
})

test("deduplicates PR reads across sessions and limits refresh per PR", async () => {
  let time = 1000, calls = 0
  const reader = makePullReader({ now: () => time, readFn: async (ref) => { calls++; return ref } })
  const a = "https://github.com/Org/Repo/pull/1"
  const b = "https://github.com/org/repo/pull/1"
  await Promise.all([reader(a), reader(b)])
  assert.equal(calls, 1)
  time += 60000
  await reader(a)
  assert.equal(calls, 2)
})

test("one inaccessible PR does not hide other PRs and concurrency is bounded", async () => {
  let active = 0, max = 0
  const urls = Array.from({ length: 8 }, (_, i) => `https://github.com/org/repo/pull/${i + 1}`)
  const rows = await readReferencedPulls(urls, async (url) => {
    active++; max = Math.max(max, active)
    await new Promise((resolve) => setImmediate(resolve))
    active--
    const ref = parsePullUrl(url)
    if (ref.number === 2) throw new Error("private details")
    return { number: ref.number, repo: "org/repo", url, status: "Open" }
  }, "", 2)
  assert.equal(max, 2)
  assert.deepEqual(rows.map((row) => row.number), [1, 2, 3, 4, 5, 6, 7, 8])
  assert.equal(rows[1].status, "Unavailable")
  assert.ok(!JSON.stringify(rows).includes("private details"))
})

test("uses the latest decisive review per reviewer", () => {
  const review = (login, state) => ({ user: { login }, state })
  assert.equal(reviewStatus([]), "Awaiting review")
  assert.equal(reviewStatus([review("a", "CHANGES_REQUESTED"), review("a", "APPROVED")]), "Approved")
  assert.equal(reviewStatus([review("a", "APPROVED"), review("b", "CHANGES_REQUESTED")]), "Changes requested")
  assert.equal(reviewStatus([review("a", "APPROVED"), review("a", "DISMISSED")]), "Awaiting review")
})

test("shares in-flight results and limits GitHub reads to once per minute per branch", async () => {
  let time = 1000, calls = 0, branch = "feat/one"
  const reader = makeReader({
    now: () => time,
    identifyFn: async () => ({ branch, origin: { owner: "me" }, target: { owner: "org", repo: "repo" } }),
    readFn: async (info) => { calls++; return { branch: info.branch } },
  })
  const first = await Promise.all([reader("a"), reader("b")])
  assert.deepEqual(first.map((item) => item.data), [{ branch }, { branch }])
  assert.deepEqual(first.map((item) => item.cached), [false, true])
  assert.equal(calls, 1)
  time += 59999
  await reader("a")
  assert.equal(calls, 1)
  time += 1
  await reader("a")
  assert.equal(calls, 2)
  branch = "feat/One"
  await reader("a")
  assert.equal(calls, 3)
})
