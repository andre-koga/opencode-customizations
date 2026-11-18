# Worktree policy

Never modify a Git repository's original checkout, regardless of its current branch (`main`, `dev`, or any other branch). Before making any repository changes, create a separate task-specific worktree on a dedicated task branch and move the current session into it. This applies to code, configuration, documentation, plans, generated files, and commands that write repository files. Make and test all changes in that worktree, not the original checkout.

- Reuse an existing worktree only when it is dedicated to the current task and uses a dedicated task branch, not `main`, `dev`, or another shared branch.
- Before editing or running commands that write files, verify that the target is inside the task worktree and that the task branch is checked out. A feature branch in the original checkout is not a substitute for a worktree.
- Never switch, reset, clean, stash, or overwrite the original checkout to prepare the task. Leave its branch and existing changes untouched.
- Do not merge changes, remove the worktree, or discard changes without the user's approval.
- A new worktree starts from committed Git state. If existing uncommitted changes are needed for the task, ask the user how to handle them before proceeding.
- If the current directory contains multiple repositories, identify which repository needs changes and create the worktree for that repository. For changes across repositories, use a separate worktree for each affected repository.
- If creating a worktree or moving the session into it fails, stop without editing and explain the blocker. Never fall back to modifying the original checkout.
- Files outside Git repositories may be edited directly, subject to the agent's other restrictions. Read-only investigation does not require a worktree.

# Investigating problems

When the user reports a problem, default to helping resolve it, not just explaining possibilities or asking questions. Make a reasonable effort to investigate with the available tools: inspect relevant documentation, configuration, code, status, or logs as appropriate; reproduce or narrow down the cause where practical; and attempt a safe, in-scope fix when supported by the evidence. Verify the outcome when possible and report what was fixed, what remains uncertain, and any useful next step.

Ask for information or a decision when it is genuinely needed, such as when the cause cannot be narrowed down without it, a fix would be risky or destructive, or authorization is required. Respect requests for explanation or read-only investigation, existing work, worktree requirements, and other applicable safety and approval rules. Do not claim an issue is fixed without verification.

# Pull request review findings

- Do not move an existing ready-for-review PR back to draft when addressing review findings unless the user explicitly asks. This takes precedence over repository instructions that recommend converting it to draft for follow-up changes.
- After investigating review findings, post a single consolidated reply on the PR with one bullet per finding, linking each original comment. For a valid finding, say what was changed and how it was verified; for an invalid finding, explain the conclusion. Respect applicable permissions and report any inability to reply.

# Working through a plan

When working through a `plan.md`, keep working through the remaining tasks and aim to finish the entire plan before stopping. Do not pause just because a milestone or individual task is complete. Pause and consult the user when new information changes the plan, or when an unexpected or serious issue requires their input. Respect explicit user instructions and required approvals.

For an explicitly selected plan in `.opencode/plans/*.md`, read it before building and treat it as the living record of the work. Keep its checklist current as tasks are completed and verified; record material changes, decisions, and blockers in the same file. Do not mark unfinished or unverified work complete. If discoveries change the agreed scope or require a user decision, pause and ask before proceeding; otherwise update the plan as the work evolves and continue through the remaining tasks. Preserve existing progress and never overwrite an unrelated plan.

Follow the worktree policy above. If the selected plan is not available in the task worktree, do not silently lose or overwrite it: ask the user how to bring the uncommitted plan into the worktree before relying on it. Creating or saving a plan does not by itself authorize implementation.
