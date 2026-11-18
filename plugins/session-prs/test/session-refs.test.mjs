import test from "node:test"
import assert from "node:assert/strict"
import { pullReferences, sessionPullReferences } from "../src/session-refs.mjs"

test("finds and deduplicates PR links from messages and successful creation output", () => {
  const messages = [
    { type: "user", text: "Please fix https://github.com/org/api/pull/10 and https://github.com.evil/org/api/pull/12" },
    { type: "assistant", content: [
      { type: "text", text: "Opened [PR](https://github.com/ORG/api/pull/10) and https://github.com/org/web/pull/20/files" },
      { type: "tool", state: { status: "completed", input: { command: "gh pr list" }, content: [{ type: "text", text: "https://github.com/org/api/pull/99" }] } },
      { type: "tool", state: { status: "completed", input: { command: "gh pr create --draft" }, content: [{ type: "text", text: "https://github.com/org/api/pull/30" }] } },
    ] },
  ]
  assert.deepEqual(pullReferences(messages).urls, ["https://github.com/org/api/pull/10", "https://github.com/org/web/pull/20", "https://github.com/org/api/pull/30"])
})

test("reads paginated history and flags bounded history", async () => {
  const calls = []
  const client = { message: { list: async (input) => {
    calls.push(input)
    if (input.cursor && input.order) throw new Error("cursor cannot be combined with order")
    return input.cursor ? { data: [{ type: "user", text: "https://github.com/a/b/pull/2" }], cursor: { next: "another" } } : { data: [{ type: "user", text: "https://github.com/a/b/pull/1" }], cursor: { next: "next" } }
  } } }
  const result = await sessionPullReferences(client, "ses_test", { maxPages: 2, pageSize: 10 })
  assert.deepEqual(result.urls, ["https://github.com/a/b/pull/1", "https://github.com/a/b/pull/2"])
  assert.equal(result.truncated, true)
  assert.deepEqual(calls[0], { sessionID: "ses_test", limit: 10, order: "desc" })
  assert.deepEqual(calls[1], { sessionID: "ses_test", limit: 10, cursor: "next" })
})

test("preserves PRs already found if a later page fails", async () => {
  const client = { message: { list: async (input) => {
    if (input.cursor) throw new Error("server unavailable")
    return { data: [{ type: "user", text: "https://github.com/a/b/pull/12" }], cursor: { next: "next" } }
  } } }
  const result = await sessionPullReferences(client, "ses_test")
  assert.deepEqual(result.urls, ["https://github.com/a/b/pull/12"])
  assert.equal(result.incomplete, true)
  assert.equal(result.truncated, false)
})

test("reports first-page errors instead of showing empty history as complete", async () => {
  const client = { message: { list: async () => { throw new Error("offline") } } }
  await assert.rejects(sessionPullReferences(client, "ses_test"), /offline/)
})

test("reports when reference limit is reached", () => {
  const refs = pullReferences([{ type: "user", text: "https://github.com/a/b/pull/1 https://github.com/a/b/pull/2" }], 1)
  assert.equal(refs.urls.length, 1)
  assert.equal(refs.truncated, true)
})

test("includes deduplicated prior session locations, with a bounded limit", async () => {
  const messages = Array.from({ length: 22 }, (_, i) => ({
    type: "location-switched", location: { directory: `/work/${i}` }, previous: { location: { directory: "/work/0" } },
  }))
  const client = { message: { list: async () => ({ data: messages, cursor: {} }) } }
  const result = await sessionPullReferences(client, "ses_test")
  assert.equal(result.directories.length, 20)
  assert.equal(new Set(result.directories).size, 20)
  assert.equal(result.truncated, true)
})
