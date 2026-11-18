import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import plugin from '../../src/gui'
import fixture from '../fixtures/sample-plan.md?raw'
import { Panel, Style } from './sdk'

const [content, setContent] = createSignal(fixture)
const [sessionKey, setSessionKey] = createSignal('active')
const calls: any = { prompts: [], switches: [], quotes: [], native: [], external: [], draft: '', focused: false }
let resolveQuestion: ((text?: string) => void) | undefined
const session = { id: 's1', key: 'active', server: { client: { session: {
  switchAgent: async (input: any) => calls.switches.push(input),
  prompt: async (input: any) => calls.prompts.push(input),
} } } }
const screen = {
  file: { root: '/fixture-workspace', sync: async () => {}, unwatch() {}, get: () => ({ content: { type: 'text', content: content() } }) },
  composer: { quotable: () => true, text: () => calls.draft, insert: (text: string) => { calls.draft += text }, attach: (quote: any) => calls.quotes.push(quote), focus: () => { calls.focused = true } },
}
const entries = new Map()
plugin.setup({
  id: 'plan-renderer',
  use: () => () => ({ status: 'active', value: { open: (s: any, url: string) => { calls.native.push({ session: s.id, url }); return true } } }),
  add: (kind: any, value: any) => {
    if (kind === Style) { const style = document.createElement('style'); style.textContent = value; document.head.append(style) }
    else entries.set(kind, value)
  },
  sessions: { current: () => ({ ...session, key: sessionKey() }) }, screen: { current: () => screen },
  dialogs: { prompt: () => new Promise<string | undefined>((resolve) => { resolveQuestion = resolve }) },
  system: { openExternal: (url: string) => calls.external.push(url) },
  ui: { Button: (props: any) => <button type="button" disabled={props.disabled} onClick={props.onClick}>{props.children}</button>, Markdown: (props: any) => <pre>{props.text}</pre> },
} as any)
const panel = entries.get(Panel)
const tab = panel.list({ open: [encodeURIComponent('.opencode/plans/sample-plan.md')] })[0]
render(() => panel.render({ tab, session, screen }), document.getElementById('app')!)
render(() => <div class="smoke-controls">
  <button onClick={() => setSessionKey(sessionKey() === 'active' ? 'other' : 'active')}>Switch active chat</button>
  <button onClick={() => setContent('# Old plan\n\n## Goal\nKeep this old idea\n\n## Checklist\n- [x] investigated\n- [ ] build')}>Load legacy plan</button>
  <button onClick={() => setContent(fixture)}>Load v1 plan</button>
</div>, document.getElementById('controls')!)
;(window as any).planSmoke = { calls, resolveQuestion: (text?: string) => { resolveQuestion?.(text); resolveQuestion = undefined }, setDraft: (text: string) => { calls.draft = text }, setContent, fixture }
