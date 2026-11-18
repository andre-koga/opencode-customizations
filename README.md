# OpenCode customizations

My useful OpenCode plugins, skills, agents, commands, and global instructions, backed up here so I can restore or adapt them later. These are personal tools, not official OpenCode features.

## What's here

- `plugins/github-pr-links`: opens GitHub pull request links in the native PR viewer when available, otherwise the OpenCode browser.
- `plugins/session-prs`: the **Orchestrator** side panel for open chat sessions and their related PRs.
- `plugins/native-pr`: a native GitHub PR viewer with cached results, review findings, and confirmation before merging.
- `plugins/plan-renderer`: a Markdown plan side panel with task progress and a Build button that switches the current chat to the build agent.
- `plugins/org-prs`: a pinned, sortable list of your organization-wide PRs that opens entries in the native PR viewer.
- `plugins/persistent-github`: an experimental GitHub panel with a separate persistent browser profile.
- `agents/planner.md`: a planning-only agent that investigates, asks questions, and saves a Markdown plan for a builder to maintain.
- `skills/pr-followthrough`: an explicitly invoked workflow for following up on PRs created in the current conversation.
- `commands/tldr.md`: a concise conversation-summary command.
- `commands/save-custom-setup.md`: `/save-custom-setup` backs up and pushes global customizations to this repository with safety checks.
- `commands/my-prs.md`: `/my-prs` gives an action-oriented, read-only summary of your open organization PRs.
- `AGENTS.md`: my global OpenCode working instructions, including worktree and plan-maintenance policies.

The desktop plugins use experimental OpenCode APIs and may need changes after OpenCode updates. See each plugin's README for its behavior and limitations. The checked-in `gui-experimental.cjs` files are the plugin entry points; sources, tests, and dependency lockfiles are included where available.

## Restore

1. Clone this repository and review its contents, especially `AGENTS.md`, before using it. Back up your existing `~/.config/opencode` directory first.
2. Copy the desired directories (`plugins`, `agents`, `skills`, and `commands`) into `~/.config/opencode/`, taking care not to overwrite customizations you want to keep. Copy or merge `AGENTS.md` only if you want these global instructions.
3. For plugins with a `package-lock.json`, run `npm ci` in the plugin directory if dependencies are needed. Run `npm test` there to check the plugin, and `npm run build` to rebuild its entry point when changing source. `github-pr-links` has no build step in this backup.
4. Merge the desired plugin entries into your existing `~/.config/opencode/opencode.jsonc`; preserve other configuration. For example:

   ```jsonc
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [
       "./plugins/github-pr-links", "./plugins/session-prs", "./plugins/native-pr", "./plugins/plan-renderer",
       { "package": "./plugins/org-prs", "options": { "organization": "example-org" } }
     ]
   }
   ```

   Replace `example-org` with your organization; the public backup intentionally does not contain a local organization default. `/my-prs` uses the configured organization or asks for one. Add `./plugins/persistent-github` if you want the experimental browser panel too. GitHub features require an authenticated `gh` CLI where described by each plugin. The plan renderer opens plan links from chat or the **Open plan renderer** command; ordinary file-tree clicks still use the built-in Markdown viewer.

5. Select **planner** in OpenCode to plan, and explicitly point the build agent at the saved plan when ready. With the included worktree policy, start or move the session into a dedicated task worktree before saving a plan inside a Git repository; the planner itself cannot run shell commands or create worktrees.

This is a snapshot, not an automatic backup: commit and push future customization changes to keep it current. Local service state, browser profiles, credentials, installed dependencies, and machine-specific OpenCode configuration are intentionally excluded. One organization-specific test fixture was replaced with a generic example in this public backup.
