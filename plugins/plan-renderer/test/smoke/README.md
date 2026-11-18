# Interaction smoke harness

Run `npm run smoke` from the plugin directory, then open `http://127.0.0.1:4187`.
It uses the actual Solid PlanView with fake OpenCode host interfaces. No agent
messages, GitHub reads, filesystem writes, or PR mutations leave this harness.
The example PR/evidence is expressly illustrative. Markdown is shown as text;
the real host supplies its Markdown renderer.

Check:

- Goal alone appears initially; each section tab filters content; All shows full source.
- Keyboard Left/Right/Home/End switches/focuses tabs. ARIA tabs name the content panel.
- Checklist shows all six statuses, phase groups, and 1/4 active completion (2 retired).
- Status filters work; PR links call the native navigation contract, not external navigation.
- Explain/Review evidence add quotes with plan path/revision/task ID/evidence but never send.
- Ask waits for the fake dialog; use `planSmoke.resolveQuestion('your question')`.
- Set an existing draft with `planSmoke.setDraft('keep me')`; question actions preserve it.
- While Ask is pending, switch active chat; resolving the dialog must not attach/send.
- Build calls the fake switchAgent before the fake queue, naming the revision and rules.
- Legacy/malformed content remains readable, Build is disabled, and normalization is only a draft.
- At 380px and 700px canvas widths, task cards wrap without horizontal body overflow.
- Set the document color scheme and body colors to check both light and dark themes.

Useful read-only observations: `planSmoke.calls`, active tab's `aria-selected`,
`.plan-task` count, and console errors. `planSmoke.setContent(...)` simulates live
file updates. This checks UI behavior and contract invocation, not actual desktop
composer/native-PR rendering; verify those in the installed app when available.
