# Local plugin design system

All custom panels import `theme.css` through the GUI `Style` registry and use an
`oc-panel` root with reactive `data-theme`. Styles are scoped; they do not restyle
OpenCode's own UI or embedded websites. Rebuild each consuming plugin after edits.

## Semantic colors

- Purple: merged PRs and completed plan tasks.
- Green: successful, approved, ready, zero current findings; GitHub's Open PR
  lifecycle badge (Open is not a claim of merge readiness).
- Amber: running, waiting, queued, outdated evidence.
- Red: failed, blocked, conflicts, requested changes, current nonzero findings.
- Blue: information and navigation.
- Gray: draft, closed without merging, skipped, cancelled, unknown or unavailable.

Individual CI cancellations remain failed outcomes for that run; a cancelled plan
task is retired, not failed. No visual mapping changes backend status decisions.
Labels accompany color; unknown and incomplete evidence must never appear green.

Use **thread** for OpenCode conversations, **Conversation** for GitHub discussion,
**Checks** for CI results, **Findings** for bot review counts, and **Outdated** for
evidence from a previous commit. Keep machine status values unchanged.

Shared primitives: `oc-toolbar`, `oc-actions`, `oc-button`, `oc-tabs`, `oc-tab`,
`oc-table-wrap`, `oc-table`, `oc-link`, `oc-badge`, `oc-alert`, `oc-card`, `oc-status`.
Use semantic `data-tone` on badges and notices; don't hardcode another palette.

## Verify changes

Run `node --test ~/.config/opencode/plugins/shared-ui/status.test.mjs` and each
consumer's `npm run build` and `npm test`. For actual component previews with mock
data, run from `shared-ui/smoke`:

```sh
node ../../plan-renderer/node_modules/vite/bin/vite.js --config vite.config.mjs
```

Open `http://127.0.0.1:4198/` and switch panels and themes. This fixture does not
call GitHub, use credentials, or send instructions to an agent. It exercises the
actual Solid panel components with a fake GUI host.
