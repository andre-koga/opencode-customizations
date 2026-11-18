# Native PR viewer

Shows GitHub pull requests in an OpenCode Desktop side panel, using the local
authenticated `gh` CLI. It includes descriptions, review and issue comments,
CI checks, and file patches. GitHub text is shown as plain text rather than
rendered HTML. A primary action offers to mark a draft ready, merge a ready PR
with a merge commit, or ask the active OpenCode thread to investigate conflicts
or blockers. Merge and ready actions require confirmation, re-read current status,
and require the head commit to match. GitHub enforces branch rules and permissions.
The panel does not post comments, approve reviews, bypass rules, or delete branches.

The viewer is opened by the `github-pr-links` and `session-prs` plugins. If it
is unavailable, those plugins fall back to their original browser behavior.
The viewer makes REST requests on open or Refresh, never polls, and uses a
60-second cache. Each section fetches up to 100 items and says when capped.
Mergeability or incomplete checks are never treated as ready; ordinary pending
checks cannot trigger an agent request. Confirmed actions re-check fresh data.

Requires an authenticated `gh` CLI and local access to github.com. Source code
and logs do not store authentication tokens. OpenCode's GUI API is experimental.
