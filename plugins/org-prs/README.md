# My organization PRs

**My organization PRs** is pinned in the side-panel tab strip across chats;
select its tab, use the side-panel **+** menu, or run **Open my organization
PRs** in the command palette. Other tabs can still be selected. The panel lists PRs authored by the
account authenticated with `gh` across the configured organization. **Open** is the default;
**All** includes closed and merged PRs. Click a PR to open the native PR
viewer, with a browser fallback if that plugin is unavailable.

The list shows repository, title, state, last update and issue discussion comment
count. It does not fetch CI or inline-review counts for each PR, avoiding extra
requests. Click any column heading to cycle ascending, descending, and the
original GitHub order; PRs sort numerically by number, and missing values stay
last. Status names use distinct light- and dark-theme colors. Sorting is local
and does not make GitHub requests. It uses GitHub's REST Search API, follows result pages up to GitHub's
1,000-result search limit, reports incomplete results, caches each filter for
60 seconds and does not poll. Refresh within the cache period uses cached data.
Results are limited to the authenticated account's repository access.

Set the organization in global `opencode.jsonc`; this portable backup does not
include a private local default. Merge the entry with your existing plugins:

```jsonc
{ "plugins": [{ "package": "./plugins/org-prs", "options": { "organization": "example-org" } }] }
```

Requires an authenticated `gh` CLI. Build with `npm run build` and test with
`npm test`. The OpenCode Desktop GUI plugin API is experimental.
