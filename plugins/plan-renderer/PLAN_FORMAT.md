# OpenCode plan format v1

This is the shared contract for the planner, builder, validator, and plan renderer.
Active plans are ordinary Markdown at `.opencode/plans/<plan-id>.md`. Keep one
active file per plan. Never mutate a plan merely to display it.

## Fixed layout

Start with simple, unquoted frontmatter, followed by one `#` title and exactly
these nine `##` headings, in this order and with this spelling:

1. Goal
2. Scope
3. Context
4. Approach
5. Acceptance criteria
6. Risks and dependencies
7. Verification
8. Decisions and history
9. Checklist

Goal is the first content section. Checklist is the final section—nothing is
appended after it. Use `###` headings inside sections as needed. Keep every
section, even when its content is `None — <explanation>`. Only Checklist contains
task checkboxes; acceptance criteria are ordinary bullets, not a second todo list.
Fenced code is example content, not headings or tasks.

Required frontmatter:

- `plan-format: 1`: schema version, not the plan revision.
- `plan-id`: stable lowercase kebab-case ID matching the active filename.
- `revision`: positive integer; increments on material scope/design changes.
- `status`: `draft`, `approved`, `in-progress`, `blocked`, or `completed`.
- `implementation`: `not-authorized` or `authorized`. Approval to save a plan is
  not approval to implement it. Only an explicit user build request changes this.
- `updated`: date of the last substantive/progress edit, in `YYYY-MM-DD` format.

## Section responsibilities

- **Goal:** the problem, desired outcome, and why it matters; concise, no progress log.
- **Scope:** in scope, out of scope, and authorization boundaries.
- **Context:** relevant existing behavior, paths/repos, evidence, and assumptions.
- **Approach:** the current agreed design and ordered delivery strategy. Mark pending
  proposals explicitly; do not present them as approved decisions.
- **Acceptance criteria:** observable outcomes that determine success.
- **Risks and dependencies:** risks, collisions, blockers, prerequisites, and
  user decisions still required.
- **Verification:** tests, commands, environments, independent correctness checks,
  and evidence needed for completion. Record actual outcomes rather than claiming
  unexecuted checks passed.
- **Decisions and history:** dated decisions and an append-only material-revision
  log, with previous-revision links and reasons for changed/rejected ideas.
- **Checklist:** the sole task ledger; phase headings are optional.

## Task contract

Every task is a top-level dash checkbox, a stable ID (`T001`, `T002`, ...), an em
dash, and a short title. Bold is recommended. Exactly these five two-space-indented
fields follow it; keep them in this order. Put long explanations in Notes using
four-space continuation lines. No nested task checkboxes.

```md
- [ ] **T001 — Implement the document validator**
  - Status: todo
  - Depends on: none
  - PRs: none
  - Verification: pending — validator contract tests and a real build
  - Notes: none

- [x] **T002 — Add validation examples**
  - Status: done
  - Depends on: T001
  - PRs: [PR #42](https://github.com/example/project/pull/42)
  - Verification: example checks passed; record exact results in Verification
  - Notes: none
```

Allowed statuses:

| Status | Checkbox | Meaning |
| --- | --- | --- |
| todo | `[ ]` | Not started |
| in-progress | `[ ]` | Work started, not verified complete |
| blocked | `[ ]` | Cannot proceed; Notes explains the blocker/decision |
| done | `[x]` | Implemented and verified, with evidence |
| cancelled | `[ ]` | Explicitly dropped; Notes states why |
| superseded | `[ ]` | Replaced; Notes names the replacement IDs and reason |

- Never renumber, reuse, or silently remove an ID. Allocate new IDs after the
  largest existing ID, even when tasks are reordered or split.
- Depends on is `none` or comma-separated existing IDs (for example `T001, T004`).
  No self-dependencies or cycles. Completing a task does not prove its prerequisites.
- PRs is `none` until a PR exists, or one or more full HTTPS GitHub PR links.
  A completed implementation task must link the PR(s) containing its work. Never
  invent a URL or infer completion from a link. Done does not imply merged.
- Verified tasks that genuinely have no PR use `not applicable — <reason>`;
  for example local configuration changes or read-only investigations. The
  renderer shows this explicitly rather than manufacturing a PR.
- Verification describes a pending check until it was actually executed. Done
  requires meaningful evidence, not `none`, `pending`, or `not run`.
- Cancelled/superseded tasks are retained and visible but excluded from the active
  completion denominator. They are never counted as done.

## Editing and versioning

Use **an editable current plan with preserved history**, not endless appended
alternative designs and not destructive replacement:

1. Before a material change (goal/scope, architecture, acceptance, dropping or
   replacing tasks), preserve the exact current file as
   `.opencode/plans/history/<plan-id>/rNNN.md`, using the current revision padded
   to at least three digits. Never overwrite a snapshot. If that path already
   exists with different content, stop and ask how to resolve the conflict.
2. Edit the active sections to describe one coherent current plan; increment
   revision and update the date. Preserve task IDs, progress, verification, and PRs.
3. Append a dated entry to Decisions and history linking the old snapshot. State
   what changed, why, which ideas were rejected/superseded, and the user's approval
   or the still-pending decision. Do not erase previous history entries.
4. Retain cancelled/superseded tasks with explicit statuses and replacement IDs.
   If verified work must be reopened, explain why and keep its prior evidence/PRs.
5. Progress/status/evidence/PR-link updates and typo fixes do not require a new
   material revision; update `updated` and preserve existing evidence. Record a
   substantive reopening/blocker in Decisions and history.
6. Proposals that change agreed scope require a user decision before implementation.
   Snapshotting or editing a plan is not implementation authorization.

Git history complements snapshots, but is not a substitute: plans may be untracked
or local-only. Never auto-commit, publish, merge, or discard work to create history.
Historic snapshots are references, not active build targets. Relative snapshot
links can open in the ordinary file viewer; the plan renderer opens active plans only.

When normalizing an existing nonstandard plan, snapshot it first. Preserve all
ideas/evidence and completed work. If you cannot safely map a status, leave it
unresolved rather than guessing. Do not silently replace an unrelated plan.

## Validation and handoff

Read this file before writing/normalizing a plan. Validate before saying it is saved
or ready, and after material revisions:

```sh
node ~/.config/opencode/plugins/plan-renderer/src/validate.mjs /absolute/path/to/.opencode/plans/plan-id.md
```

Validation reports format errors; it cannot prove truth, authorization, test success,
or preservation of history. The renderer does not edit task state. Its question
actions stage context for user review; its Build action requires a valid v1 plan
and gives the builder the versioning/status rules. The builder must read and keep
the ledger current, complete only verified tasks, follow worktree and repository
rules, and pause for required approvals. A fresh build session must not lose an
uncommitted selected plan when changing worktrees.

## Starting template

```md
---
plan-format: 1
plan-id: example-plan
revision: 1
status: draft
implementation: not-authorized
updated: 2026-11-18
---

# Example plan

## Goal

Describe the intended outcome.

## Scope

### In scope
- Describe the approved work.

### Out of scope
- Describe exclusions and required approvals.

## Context

Describe relevant behavior, evidence, repositories, and paths.

## Approach

Describe the agreed design and delivery order.

## Acceptance criteria

- State a verifiable outcome.

## Risks and dependencies

None — no known blockers yet; investigate before implementation.

## Verification

Describe required tests and checks. No verification performed yet.

## Decisions and history

- 2026-11-18 — Revision 1 created; planning only, implementation not authorized.

## Checklist

### Preparation

- [ ] **T001 — Verify implementation prerequisites**
  - Status: todo
  - Depends on: none
  - PRs: none
  - Verification: pending — verify the worktree, instructions, and collisions
  - Notes: obtain implementation authorization before application edits
```
