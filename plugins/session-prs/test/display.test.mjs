import test from "node:test"
import assert from "node:assert/strict"
import { combinePulls, statusColor, visiblePulls } from "../src/display.mjs"

test("colors each status by its own state", () => {
  assert.match(statusColor("Passed"), /success/)
  assert.match(statusColor("Draft"), /weak/)
  assert.match(statusColor("Not ready"), /critical/)
  assert.match(statusColor("Failed"), /critical/)
  assert.match(statusColor("Conflicts"), /critical/)
  assert.match(statusColor("Running"), /warning/)
  assert.match(statusColor("Merged"), /completed/)
  assert.match(statusColor("Unavailable"), /weak/)
})

test("keeps distinct PR states and deduplicates references without hiding a good result", () => {
  const one = { repo: "org/api", number: 1, status: "Draft", ci: "Passed", review: "Approved", comments: 2 }
  const two = { repo: "org/api", number: 2, status: "Conflicts", ci: "Failed", review: "Changes requested", comments: 3 }
  const failedDuplicate = { repo: "ORG/API", number: 1, status: "Unavailable" }
  assert.deepEqual(combinePulls(one, [failedDuplicate, two]), [one, two])
  assert.deepEqual(combinePulls(null, [failedDuplicate, one]), [one])
})

test("optionally hides only merged PRs without changing the original list", () => {
  const pulls = [{ status: "Merged" }, { status: "Open" }, { status: "Closed" }, { status: "Unavailable" }]
  assert.deepEqual(visiblePulls(pulls, false), pulls)
  assert.deepEqual(visiblePulls(pulls, true), pulls.slice(1))
  assert.deepEqual(visiblePulls([{ status: "Merged" }], true), [])
  assert.equal(pulls.length, 4)
})
