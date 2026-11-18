# Plan renderer

In OpenCode Desktop, links to `.opencode/plans/*.md` in the active chat open a
custom side panel. To open a plan manually, use **Open plan renderer** in the
command palette and enter its path. The file tree's ordinary Markdown viewer
is unchanged because the GUI plugin API does not provide a path-specific
replacement for it.

The panel renders Markdown and counts checked and unchecked Markdown task-list
items, excluding fenced code. The Build button switches the clicked chat to
the `build` agent, then queues a message naming the exact plan. It does not
modify the plan, create a worktree, or bypass any worktree or approval policy.
If the plan is not available in the task worktree, the agent must ask how to
bring it across. The button does not automatically copy uncommitted files.

Build with `npm run build` and test with `npm test`. The desktop GUI plugin
API is experimental.
