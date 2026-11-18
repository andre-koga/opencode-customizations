import test from "node:test"
import assert from "node:assert/strict"
import { Schema } from "effect"
import { backendId, backendReadInput } from "../src/backend-schema.mjs"

test("accepts requests from older windows during plugin reload", () => {
  const decode = Schema.decodeUnknownSync(backendReadInput)
  assert.deepEqual(decode({ directory: "/repo" }), { directory: "/repo" })
  assert.deepEqual(decode({ directory: "/repo", urls: ["https://github.com/a/b/pull/1"] }), { directory: "/repo", urls: ["https://github.com/a/b/pull/1"] })
  assert.deepEqual(decode({ directory: "/repo", directories: ["/old"], urls: [] }), { directory: "/repo", directories: ["/old"], urls: [] })
  const input = { directory: "/repo", directories: ["/old"], urls: ["https://github.com/a/b/pull/1"] }
  assert.deepEqual(Schema.encodeSync(backendReadInput)(input), input)
  assert.equal(backendId, "session-prs.history-v2")
})
