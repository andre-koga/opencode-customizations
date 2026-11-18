# Plan renderer

In OpenCode Desktop, links to `.opencode/plans/*.md` in the active chat open a
custom side panel. To open a plan manually, use **Open plan renderer** in the
command palette and enter its path. The file tree's ordinary Markdown viewer
is unchanged because the GUI plugin API does not provide a path-specific
replacement for it.

## Standard layout

Read [PLAN_FORMAT.md](PLAN_FORMAT.md) for the complete v1 contract, task fields,
template, and editing/versioning policy. The planner reads the same document.
Goal is first; Checklist is last. Fixed section buttons show only that section;
All preserves the complete Markdown source, including older/unrecognized content.
Use arrow keys/Home/End to navigate the section tabs.

Checklist shows stable task IDs, explicit statuses, phase groups, filters,
verification, dependencies, and PR links. Cancelled/superseded tasks stay visible
but are excluded from the active progress denominator. Viewing never edits the
file or toggles task status. A PR link opens the existing `native-pr` panel; if
that plugin is unavailable it falls back to an external browser. Modified clicks
retain ordinary link behavior. Done means verified work, not necessarily merged.

Ask, Explain, and Review evidence attach current item context to the active chat's
composer for the user to review and send; they never automatically prompt an agent
or erase an existing draft. Async question dialogs are discarded if the selected
chat/plan changes. Section questions work the same way.

Nonstandard/malformed plans stay readable and show actionable validation errors.
Build is disabled until normalization; the normalization button stages a request
to preserve history and adopt v1, not a file edit. Archived revision snapshots
open in the ordinary file viewer, never as active Build targets.

## Build and revisions

For a valid plan, Build switches the clicked active chat to `build`, then queues
a request naming the exact plan and displayed revision. It instructs the builder
to read current source, preserve v1, use immutable snapshots before material
changes, keep stable IDs/evidence/PRs, and validate edits. Clicking Build explicitly
requests implementation but never bypasses worktree, repository, or scope approvals.
If the plan is missing from the task worktree, the builder must ask how to bring
it across. The button never copies uncommitted files, writes the plan, or commits.

Material edits snapshot the prior revision, edit the current plan in place, and
append history; progress-only edits do not create a new material revision. These
are agent instructions, not automatic backups performed by this read-only viewer.
Validation enforces shape and internal consistency, not truth or historical integrity.

Build with `npm run build` and test with `npm test`. Validate an active file with
`node src/validate.mjs /absolute/path/.opencode/plans/<plan-id>.md`.
The desktop GUI plugin API is experimental. Rebuilding the local bundle reloads
the GUI; the agent configuration is watched as well, with `/reload` available.

`npm run check` builds the current bundle before running all tests. `npm run smoke`
starts the local fake-host interaction harness; see [its checklist](test/smoke/README.md).
Browser checks exercise the real Solid view with mocked host services; they do not
claim an end-to-end verification of the installed native PR panel or desktop composer.
