# Native PR viewer

Shows GitHub pull requests in an OpenCode Desktop side panel, using the local
authenticated `gh` CLI. It includes descriptions, review and issue comments,
CI checks, and file patches. GitHub text is shown as plain text rather than
rendered HTML. A primary action offers to mark a draft ready, merge a ready PR
with a merge commit, or ask the active OpenCode thread to investigate conflicts
or blockers. Merging requires confirmation; marking a draft ready does not. Both
actions re-read current status and require the head commit to match. Marking ready
can notify reviewers and start review automation. GitHub enforces branch rules and permissions.
The panel does not post comments, approve reviews, bypass rules, or delete branches.

The viewer is opened by the `github-pr-links` and `session-prs` plugins. If it
is unavailable, those plugins fall back to their original browser behavior.
The viewer keeps recent PR snapshots in window memory across panel switches and
shows them immediately on return. It rechecks stale snapshots in the background
on open and on Refresh, never polls, and limits reads with a 60-second backend
cache. A fresh read makes REST requests and one GraphQL request for review-thread
resolution. Completed or failed actions invalidate the snapshot. The Conversation
count includes issue and inline comments and non-empty review bodies, not empty
approval events; `?` means unavailable and `+` means a section was capped.
Findings are read separately from the latest `github-actions[bot]` `review-done`
comment marker. An outdated marker is labeled when its SHA differs from the
current head; `—` means no marker and `?` means comments were unavailable or
incomplete. Nonzero findings for the current head block the merge action and
offer to ask the agent to address them. Old findings do not block the current
head. If comments cannot be fully loaded, the viewer does not assume findings
are clear. A PR without a review marker still follows its other merge checks.
Each section fetches up to 100 items and says when capped. If the first 100 review
threads are all resolved but more exist, their overall status is unknown.
Mergeability or incomplete checks are never treated as ready; ordinary pending
checks cannot trigger an agent request. While checks are running, the button
shows successful completed check runs and current successful status contexts
over their total; skipped and neutral checks count in the total, not as passed.
Actions re-check fresh data.

Requires an authenticated `gh` CLI and local access to github.com. Source code
and logs do not store authentication tokens. OpenCode's GUI API is experimental.
