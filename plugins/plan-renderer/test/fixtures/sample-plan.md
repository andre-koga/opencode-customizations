---
plan-format: 1
plan-id: sample-plan
revision: 2
status: in-progress
implementation: authorized
updated: 2026-11-18
---

# Example documentation tool

## Goal

Make example documentation easier to validate.

## Scope

### In scope
- A sample document and a local validation tool.

### Out of scope
- Publishing generated documentation automatically.

## Context

The current example has no validation step.

## Approach

Define the format, implement validation, and document its usage.

## Acceptance criteria

- Invalid example documents produce clear validation errors.

## Risks and dependencies

The validation policy is still pending.

## Verification

Use fixture-based contract tests.

## Decisions and history

- 2026-11-18 — Revision 2 clarifies the validation scope.

## Checklist

### Validation

- [ ] **T001 — Define the example format**
  - Status: todo
  - Depends on: none
  - PRs: none
  - Verification: pending — validate the contract
  - Notes: none

- [ ] **T002 — Implement the validator**
  - Status: in-progress
  - Depends on: T001
  - PRs: none
  - Verification: pending — validate the representative examples
  - Notes: keep dependency resolution controlled

- [ ] **T003 — Document validation policy**
  - Status: blocked
  - Depends on: T002
  - PRs: none
  - Verification: pending — review the policy
  - Notes: validation-policy approval is pending

### Evidence and retired work

- [x] **T004 — Add parser contract tests**
  - Status: done
  - Depends on: none
  - PRs: [PR #42](https://github.com/example/project/pull/42)
  - Verification: illustrative fixture evidence — parser tests passed
  - Notes: this fixture is example content, not a real completion claim

- [ ] **T005 — Retain the old example format**
  - Status: cancelled
  - Depends on: none
  - PRs: none
  - Verification: not applicable — task was dropped
  - Notes: replaced by the new format

- [ ] **T006 — Write a separate schema for each example**
  - Status: superseded
  - Depends on: none
  - PRs: none
  - Verification: not applicable — task was replaced
  - Notes: replaced by T001; a shared format avoids separate schemas
