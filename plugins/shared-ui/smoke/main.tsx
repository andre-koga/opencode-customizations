import { createSignal, For, Show } from 'solid-js'
import { render } from 'solid-js/web'
import native from '../../native-pr/src/gui'
import org from '../../org-prs/src/gui'
import sessions from '../../session-prs/src/gui'
import plan from '../../plan-renderer/src/gui'
import fixture from '../../plan-renderer/test/fixtures/sample-plan.md?raw'
import { Panel, Style } from './sdk'

const [mode, setMode] = createSignal('dark'), [selected, setSelected] = createSignal('native-pr')
document.body.className = mode()
const sha = 'a'.repeat(40), url = 'https://github.com/example/platform/pull/42'
const prs = [
  { number: 42, repo: 'example/platform', title: 'Unify the plugin design system', status: 'Ready', ci: 'Passed', findings: { count: 0 }, url },
  { number: 43, repo: 'example/platform', title: 'Improve the worktree preview', status: 'Merged', ci: 'Passed', findings: { count: 0 }, url: url.replace('42', '43') },
  { number: 44, repo: 'example/api', title: 'Validate background runs', status: 'Not ready', ci: 'Failed', findings: { count: 3 }, url: url.replace('42', '44') },
  { number: 45, repo: 'example/api', title: 'Track execution progress', status: 'Draft', ci: 'Running', findings: { count: 2, outdated: true }, url: url.replace('42', '45') },
]
const data = {
  ref: { owner: 'example', repo: 'platform', number: 42, url },
  pull: { title: prs[0].title, state: 'Open', author: 'example-user', head: 'feat/shared-ui', base: 'dev', sha, url, mergeable: true, mergeableState: 'clean', updatedAt: new Date().toISOString(), body: 'A consistent visual language across local OpenCode panels.', changedFiles: 8, additions: 120, deletions: 60 },
  comments: [{ author: 'github-actions[bot]', body: `<!-- review-done sha=${sha} open=0 -->`, date: new Date().toISOString() }], inline: [], reviews: [], statuses: [], limited: [], unresolvedThreads: false,
  checks: [{ name: 'Format & lint', status: 'completed', conclusion: 'success' }, { name: 'Typecheck', status: 'in_progress', conclusion: null }, { name: 'Test (web)', status: 'completed', conclusion: 'failure' }, { name: 'Build', status: 'queued', conclusion: null }, { name: 'Deploy preview', status: 'completed', conclusion: 'skipped' }],
  files: [],
}
const calls: any[] = []
const server = { id: 'mock', local: true, client: { session: { active: async () => ({}), get: async () => ({ title: 'Polish local panels', location: { directory: '/worktrees/shared-ui' } }), prompt: async (input: any) => calls.push(input) }, message: { list: async () => ({ data: [] }) } } }
const session = { id: 'mock-session', key: 'mock\nmock-session', tab: 'mock-tab', server, directory: '/worktrees/shared-ui' }
const screen = { file: { root: session.directory, sync: async () => {}, unwatch() {}, get: () => ({ content: { type: 'text', content: fixture } }) }, composer: { quotable: () => true, text: () => '', insert() {}, attach() {}, focus() {} } }
const panels = new Map()
const cleanups: (() => void)[] = []
for (const [id, plugin] of Object.entries({ 'native-pr': native, 'org-prs': org, 'session-prs': sessions, 'plan-renderer': plan })) {
  const cleanup = plugin.setup({
    id, options: { organization: 'example' }, appearance: { mode },
    main: () => ({ read: async () => ({ checkedAt: Date.now(), cached: false, data: id === 'native-pr' ? data : id === 'org-prs' ? { login: 'example-user', pulls: prs.map(pr => ({ ...pr, status: pr.status === 'Ready' ? 'Open' : pr.status, updatedAt: new Date().toISOString(), comments: 2 })), total: 4 } : { branch: 'feat/shared-ui', prs } }), refresh: async () => ({ checkedAt: Date.now(), data }), action: async () => calls.push('action') }),
    use: () => () => ({ status: 'active', value: { open: () => true } }), provide() {},
    add: (kind: any, value: any) => { if (kind === Style) { const el = document.createElement('style'); el.textContent = value; document.head.append(el) } else if (kind === Panel) panels.set(id, value) },
    sessions: { current: () => session, list: () => [session] }, screen: { current: () => screen },
    layout: { open() {}, draft: (input: any) => calls.push(input) }, tabs: { focus() {} },
    dialogs: { confirm: async () => false, prompt: async () => undefined }, system: { openExternal() {} }, toast: { show() {} },
    ui: { Markdown: (p: any) => <pre>{p.text}</pre> },
  } as any)
  if (typeof cleanup === 'function') cleanups.push(cleanup)
}
function PanelView(p: { id: string }) {
  const panel = panels.get(p.id)
  const id = p.id === 'native-pr' ? encodeURIComponent(url) : p.id === 'plan-renderer' ? encodeURIComponent('.opencode/plans/sample-plan.md') : 'main'
  const tab = panel.list({ open: [id] })[0]
  return panel.render({ tab, session, screen })
}
const disposeControls = render(() => <div class="fixture-controls"><For each={[...panels.keys()]}>{id => <button onClick={() => setSelected(id)}>{id}</button>}</For><button onClick={() => { setMode(mode() === 'dark' ? 'light' : 'dark'); document.body.className = mode() }}>{mode()} theme</button><span>Mock data · no real actions</span></div>, document.getElementById('controls')!)
const disposePanel = render(() => <Show when={selected()} keyed>{id => <PanelView id={id} />}</Show>, document.getElementById('app')!)
import.meta.hot?.dispose(() => { disposeControls(); disposePanel(); cleanups.forEach(dispose => dispose()) })
;(window as any).designSmoke = { calls, setSelected, setMode, data }
