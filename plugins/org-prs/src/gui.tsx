import { Schema } from 'effect'
import { createEffect, createSignal, For, Show } from 'solid-js'
import { Command, Contract, Ipc, MenuItem, Panel, Plugin, Style } from '@opencode/plugin/gui'
import { Browser } from '@opencode/plugin/gui/browser'
import { makeReader } from './github.mjs'
import { openPullRequest } from './navigation.mjs'
import { nextSort, sortPulls } from './display.mjs'
import { statusTone } from '../../shared-ui/status.mjs'
import theme from '../../shared-ui/theme.css?inline'

const NativePR = Contract.define('native-pr.open')
const Backend = Ipc.define({
  id: 'org-prs.lookup',
  methods: { read: { input: Schema.Struct({ organization: Schema.String, scope: Schema.String }), output: Schema.Unknown } },
})

export default Plugin.define({
  setup(ctx) {
    ctx.add(Style, theme)
    const backend = ctx.main(Backend)
    const nativePR = ctx.use(NativePR)
    const browser = ctx.use(Browser)
    const organization = typeof ctx.options.organization === 'string' ? ctx.options.organization.trim() : ''
    const tab = { id: 'main', title: 'My organization PRs', pinned: true }
    const [scope, setScope] = createSignal<'open' | 'all'>('open')
    const [rows, setRows] = createSignal<any>()
    const [error, setError] = createSignal('')
    const [busy, setBusy] = createSignal(false)
    const [stamp, setStamp] = createSignal('')
    const [sort, setSort] = createSignal<{ key: string; direction: 'asc' | 'desc' } | null>(null)
    const snapshots = new Map<string, any>()
    let generation = 0

    const openPanel = () => { const session = ctx.sessions.current(); if (session) ctx.layout.open(`${ctx.id}:main`, session) }
    ctx.add(Command, () => ({ id: 'open', title: 'Open my organization PRs', keywords: 'github pull requests authored', run: openPanel }))
    ctx.add(MenuItem, () => ({ menu: 'session.panel' as const, id: 'open', title: 'My organization PRs', icon: 'github' as const, run: openPanel }))
    ctx.add(Panel, {
      id: 'main', region: 'side', wide: true,
      list: () => [tab],
      render: (props) => <PullList session={() => props.session} />,
    })

    function display(result: any) {
      setRows(result.data)
      setStamp(`${result.cached ? 'Cached' : 'Checked'} ${new Date(result.checkedAt).toLocaleTimeString()}`)
    }
    async function load(selected: 'open' | 'all') {
      const call = ++generation
      if (!organization) {
        setBusy(false); setError('Set the organization option for the org-prs plugin in OpenCode configuration.')
        return
      }
      setBusy(true); setError('')
      try {
        const result: any = await backend.read({ organization, scope: selected })
        snapshots.set(selected, result)
        if (call === generation && selected === scope()) display(result)
      } catch {
        if (call === generation && selected === scope()) setError('Could not load PRs. Check GitHub CLI authentication, organization access, and the API rate limit.')
      } finally { if (call === generation) setBusy(false) }
    }
    function choose(selected: 'open' | 'all') {
      if (selected === scope()) return
      generation++; setBusy(false); setError(''); setScope(selected)
    }

    function PullList(props: { session: () => any }) {
      createEffect(() => {
        const selected = scope(), saved = snapshots.get(selected)
        if (saved) display({ ...saved, cached: true })
        else { setRows(undefined); setStamp('') }
        if (!saved || Date.now() - saved.checkedAt >= 60_000) void load(selected)
      })
      function open(url: string) {
        openPullRequest({ session: props.session(), url, native: nativePR(), browser: browser(), external: (target: string) => ctx.system.openExternal(target) })
      }
      const cell = {}
      const date = (value: string) => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString() }
      return <div class="oc-panel" data-theme={ctx.appearance.mode()}>
        <div class="oc-toolbar">
          <div><h2 class="oc-title">My organization PRs</h2><div class="oc-meta" style={{ margin: '4px 0 0' }}>{organization || 'Organization not configured'}{rows()?.login ? ` · @${rows().login}` : ''}</div></div>
          <div class="oc-actions">
            <button type="button" class="oc-tab" aria-pressed={scope() === 'open'} onClick={() => choose('open')}>Open</button>
            <button type="button" class="oc-tab" aria-pressed={scope() === 'all'} onClick={() => choose('all')}>All</button>
            <button type="button" class="oc-button" disabled={busy()} onClick={() => void load(scope())}>{busy() ? 'Loading…' : 'Refresh'}</button>
          </div>
        </div>
        <p class="oc-meta">{stamp()}{stamp() ? ' · ' : ''}Authored by your GitHub account · 60-second GitHub cache</p>
        <Show when={error()}><p role="alert" class="oc-alert" data-tone="critical">{error()}</p></Show>
        <Show when={!rows() && busy()}><p>Loading pull requests…</p></Show>
        <Show when={rows()}>{(data) => <>
          <Show when={data().limited || data().incomplete}><p role="status" class="oc-alert" data-tone="warning">GitHub returned incomplete results{data().limited ? ' (search is limited to 1,000 PRs)' : ''}.</p></Show>
          <p class="oc-meta">{data().pulls.length} shown{data().total !== data().pulls.length ? ` of ${data().total} results` : ''}</p>
          <Show when={data().pulls.length} fallback={<p class="oc-empty">No {scope() === 'open' ? 'open ' : ''}PRs found.</p>}>
            <div class="oc-table-wrap"><table class="oc-table" style={{ 'min-width': '620px' }}>
              <thead><tr><For each={[
                { key: 'pull', label: 'Pull request', detail: 'Sort by PR number' },
                { key: 'status', label: 'Status', detail: 'Sort by status' },
                { key: 'updated', label: 'Updated', detail: 'Sort by last update' },
                { key: 'comments', label: 'Discussion', detail: 'Sort by issue discussion comments' },
              ]}>{(column) => <th scope="col" aria-sort={sort()?.key === column.key ? (sort()?.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" class="oc-sort" title={`${column.detail}; click to cycle ascending, descending, and original order`} onClick={() => setSort(nextSort(sort(), column.key))}>{column.label} <span aria-hidden="true">{sort()?.key === column.key ? (sort()?.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button>
              </th>}</For></tr></thead>
              <tbody><For each={sortPulls(data().pulls, sort())}>{(pr: any) => <tr>
                <td><button type="button" class="oc-link" onClick={() => open(pr.url)} title={`${pr.repo} #${pr.number}: ${pr.title}`}><span class="oc-link-title">{pr.title || 'Title unavailable'}</span><span class="oc-link-meta">{pr.repo} · #{pr.number}</span></button></td>
                <td style={{ 'white-space': 'nowrap' }}><span class="oc-badge" data-tone={statusTone(pr.status)}>{pr.status}</span></td>
                <td style={{ ...cell, 'white-space': 'nowrap' }} title={pr.updatedAt}>{date(pr.updatedAt)}</td>
                <td style={cell} title="Issue discussion comments only">{pr.comments ?? '—'}</td>
              </tr>}</For></tbody>
            </table></div>
          </Show>
        </>}</Show>
      </div>
    }
  },
  main(ctx) {
    const read = makeReader()
    ctx.provide(Backend, { read: (input) => read(input) })
    ctx.log.write('info', 'Organization PR panel loaded')
  },
})
