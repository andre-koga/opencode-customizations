# Changes

## 0.2.0 — 2026-11-18

- Added the shared Plan Format v1 contract, fixed section order, typed task ledger,
  explicit no-PR reasons for local-only completed work, and a read-only validator.
- Added section tabs, focused checklist cards/status filters, preserved retired
  tasks, composer-staged questions, and the existing native PR navigation contract.
- Added safe Build gating and handoff instructions for revision snapshots, stable
  IDs, status/evidence/PR updates, and changed-revision reconfirmation.
- Updated the global planner to use the same contract, preserve material history,
  and permit permission-controlled investigation/worktree setup without implementation.
- Verified `npm run check`: bundle built and all 20 tests passed. Chromium fake-host
  checks covered section filtering, six statuses/progress, task filtering, native
  navigation contract invocation, preserving composer drafts/no automatic send,
  stale-dialog protection on chat switch, exact Build handoff, legacy normalization
  gating, keyboard tab navigation, and 380px/700px light/dark layout checks.
- Browser checks used mocked host services. Actual desktop composer/native PR
  rendering remains a live-app integration check; no GitHub mutation was performed.
- Existing plan documents were not silently normalized or changed by this tooling update.
