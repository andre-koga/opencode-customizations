import { test } from "node:test"
import { strict as assert } from "node:assert"
import { focusSession } from "../src/navigation.mjs"

test("focuses the matching open session tab, even when session IDs match across servers", () => {
  const refs = [{ key: "server-a\nsession", tab: "tab-a" }, { key: "server-b\nsession", tab: "tab-b" }]
  const focused = []
  const sessions = { list: () => refs }
  const tabs = { focus: (key) => focused.push(key) }
  assert.equal(focusSession(sessions, tabs, "server-b\nsession"), true)
  assert.deepEqual(focused, ["tab-b"])
  refs[1].tab = "new-tab-b"
  assert.equal(focusSession(sessions, tabs, "server-b\nsession"), true)
  assert.deepEqual(focused, ["tab-b", "new-tab-b"])
  refs.pop()
  assert.equal(focusSession(sessions, tabs, "server-b\nsession"), false)
  assert.deepEqual(focused, ["tab-b", "new-tab-b"])
})
