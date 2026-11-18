---
description: Back up and push my OpenCode customizations
agent: build
subagent: false
---

Back up my current global OpenCode customizations to the public GitHub repository `andre-koga/opencode-customizations`, commit the intended changes, and push them to its default branch. This invocation authorizes that commit and push, but not force-pushing, deleting files, changing unrelated repositories, or exposing private information.

1. Read applicable instructions and follow the worktree policy. Inspect the repository's current remote default branch and existing local worktrees; create and move this session to a dedicated task worktree based on the current remote state, or reuse one dedicated to this invocation. Preserve existing uncommitted work. If relevant uncommitted repository changes, conflicts, divergent remote history, or another person's work need a decision, stop and ask rather than overwriting, resetting, stashing, merging, or force-pushing.
2. Compare the global OpenCode configuration directory (`${XDG_CONFIG_HOME:-$HOME/.config}/opencode`) with the backup. Include intended changes to `AGENTS.md`, custom agents, commands, skills, plugins, and their source, tests, manifests, lockfiles and required built entrypoints. Preserve repository-only files and existing intentionally anonymized examples; do not use deletion-based sync. Include new customizations as appropriate.
3. The repository is public. Never publish secrets, credentials, tokens, personal or customer data, private paths, local databases, browser profiles, session state, installed dependencies, caches, or machine-specific configuration. Inspect changes and generated files; anonymize examples when safe, and ask if publication or redaction is uncertain. Do not copy `opencode.json(c)` or `service.json` without explicit approval and a safety review.
4. Rebuild and run relevant tests for changed plugins, review the diff and check for sensitive material, then stage only the intended files. Commit the changes with a concise message. If there is nothing new to commit, report that; do not create an empty commit. Do not silently include unrelated commits.
5. Push the intended commit(s) to the repository's default branch only if it is a non-force fast-forward; stop and ask if the push would overwrite or integrate unexpected history. Verify the remote contains the commit. Report the commit, tests, any skipped or blocked items, and the push result.

Additional instructions, if provided: $ARGUMENTS
