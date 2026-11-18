import test from "node:test"
import assert from "node:assert/strict"
import { checkStatus, makeReader, makePullReader, parsePullUrl, parseRemote, pullStatus, readReferencedPulls, reviewStatus } from "../src/github.mjs"

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
