# OpenCode customizations

My useful OpenCode plugins, skills, agents, commands, and global instructions, backed up here so I can restore or adapt them later. These are personal tools, not official OpenCode features.

## What's here

- `plugins/github-pr-links`: opens GitHub pull request links in the native PR viewer when available, otherwise the OpenCode browser.
- `plugins/session-prs`: the **Orchestrator** side panel for open threads and their related PRs.
- `plugins/native-pr`: a native GitHub PR viewer with cached results, review findings, and confirmation before merging.
- `plugins/plan-renderer`: a Markdown plan side panel with task progress and a Build button that switches the current chat to the build agent.
- `plugins/org-prs`: a pinned, sortable list of your organization-wide PRs that opens entries in the native PR viewer.
- `plugins/persistent-github`: an experimental GitHub panel with a separate persistent browser profile.
- `plugins/shared-ui`: shared light/dark styles, semantic status colors, terminology, and a mock-data visual test harness for the custom panels. Purple means merged/completed, green means ready/passed, amber means in progress/outdated, red means failed/blocked, and gray means inactive/unknown.
- `agents/planner.md`: a planning-only agent that investigates, asks questions, and saves a Markdown plan for a builder to maintain.
- `skills/pr-followthrough`: an explicitly invoked workflow for following up on PRs created in the current conversation.
- `skills/run-worktree.md`: a generic, explicitly invoked local frontend preview workflow for the current task worktree. Private environment details are omitted.
- `commands/tldr.md`: a concise conversation-summary command.
- `commands/save-custom-setup.md`: `/save-custom-setup` backs up and pushes global customizations to this repository with safety checks.
- `commands/my-prs.md`: `/my-prs` gives an action-oriented, read-only summary of your open organization PRs.
- `AGENTS.md`: my global OpenCode working instructions, including worktree and plan-maintenance policies.

The desktop plugins use experimental OpenCode APIs and may need changes after OpenCode updates. See each plugin's README for its behavior and limitations. The checked-in `gui-experimental.cjs` files are the plugin entry points; sources, tests, and dependency lockfiles are included where available.

## Restore

1. Clone this repository and review its contents, especially `AGENTS.md`, before using it. Back up your existing `~/.config/opencode` directory first.
2. Copy the desired directories (`plugins`, `agents`, `skills`, and `commands`) into `~/.config/opencode/`, taking care not to overwrite customizations you want to keep. Copy or merge `AGENTS.md` only if you want these global instructions.
3. Copy `plugins/shared-ui` alongside the other plugins: it is a source dependency, not a plugin to add to the configuration. For plugins with a `package-lock.json`, run `npm ci` in the plugin directory if dependencies are needed. Run `npm test` there to check the plugin, and `npm run build` to rebuild its entry point when changing source. Also run `node --test plugins/shared-ui/status.test.mjs` from the backup root. Rebuild all five panel plugins after changing shared styles. `github-pr-links` has no build step in this backup. See `plugins/shared-ui/README.md` for the mock-data visual harness.
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

5. Select **planner** in OpenCode to plan, and explicitly point the build agent at the saved plan when ready. The current planner permits tools broadly and relies on its instructions, rather than a restrictive allowlist, to prevent implementation and external mutations. Review its permissions before enabling it. With the included worktree policy, it may create and move into a dedicated task worktree before saving a plan.

This is a snapshot, not an automatic backup: commit and push future customization changes to keep it current. Local service state, browser profiles, credentials, installed dependencies, and machine-specific OpenCode configuration are intentionally excluded. One organization-specific test fixture was replaced with a generic example in this public backup.
