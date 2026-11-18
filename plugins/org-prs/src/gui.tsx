import { Schema } from 'effect'
import { createEffect, createSignal, For, Show } from 'solid-js'
import { Command, Contract, Ipc, MenuItem, Panel, Plugin } from '@opencode/plugin/gui'
import { Browser } from '@opencode/plugin/gui/browser'
import { makeReader } from './github.mjs'
import { openPullRequest } from './navigation.mjs'
import { nextSort, sortPulls, statusColor } from './display.mjs'

const NativePR = Contract.define('native-pr.open')
const Backend = Ipc.define({
  id: 'org-prs.lookup',
  methods: { read: { input: Schema.Struct({ organization: Schema.String, scope: Schema.String }), output: Schema.Unknown } },
})

export default Plugin.define({
  setup(ctx) {
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
      const cell = { padding: '9px 8px', 'border-bottom': '1px solid #8883', 'vertical-align': 'top' }
      const date = (value: string) => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString() }
      return <div style={{ height: '100%', overflow: 'auto', padding: '18px', 'font-size': '13px' }}>
        <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', gap: '12px', 'flex-wrap': 'wrap' }}>
          <div><strong style={{ 'font-size': '16px' }}>My organization PRs</strong><div style={{ opacity: 0.7, 'margin-top': '4px' }}>{organization || 'Organization not configured'}{rows()?.login ? ` · @${rows().login}` : ''}</div></div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <ctx.ui.Button variant={scope() === 'open' ? 'contrast' : 'neutral'} onClick={() => choose('open')}>Open</ctx.ui.Button>
            <ctx.ui.Button variant={scope() === 'all' ? 'contrast' : 'neutral'} onClick={() => choose('all')}>All</ctx.ui.Button>
            <ctx.ui.Button disabled={busy()} onClick={() => void load(scope())}>{busy() ? 'Loading…' : 'Refresh'}</ctx.ui.Button>
          </div>
        </div>
        <p style={{ opacity: 0.7, 'font-size': '12px', 'margin': '12px 0' }}>{stamp()}{stamp() ? ' · ' : ''}Authored by your GitHub account · refresh is cached for 60 seconds</p>
        <Show when={error()}><p role="alert" style={{ color: '#e27777' }}>{error()}</p></Show>
        <Show when={!rows() && busy()}><p>Loading pull requests…</p></Show>
        <Show when={rows()}>{(data) => <>
          <Show when={data().limited || data().incomplete}><p role="status" style={{ color: '#c8952c' }}>GitHub returned incomplete results{data().limited ? ' (search is limited to 1,000 PRs)' : ''}.</p></Show>
          <p style={{ opacity: 0.7 }}>{data().pulls.length} shown{data().total !== data().pulls.length ? ` of ${data().total} results` : ''}</p>
          <Show when={data().pulls.length} fallback={<p>No {scope() === 'open' ? 'open ' : ''}PRs found.</p>}>
            <table style={{ width: '100%', 'min-width': '620px', 'border-collapse': 'collapse', 'text-align': 'left' }}>
              <thead><tr><For each={[
                { key: 'pull', label: 'Pull request', detail: 'Sort by PR number' },
                { key: 'status', label: 'Status', detail: 'Sort by status' },
                { key: 'updated', label: 'Updated', detail: 'Sort by last update' },
                { key: 'comments', label: 'Comments', detail: 'Sort by issue discussion comments' },
              ]}>{(column) => <th scope="col" aria-sort={sort()?.key === column.key ? (sort()?.direction === 'asc' ? 'ascending' : 'descending') : 'none'} style={{ ...cell, opacity: 0.75, 'white-space': 'nowrap' }}>
                <button type="button" title={`${column.detail}; click to cycle ascending, descending, and original order`} onClick={() => setSort(nextSort(sort(), column.key))} style={{ cursor: 'pointer', 'font-weight': 'inherit', color: 'inherit', 'text-align': 'left' }}>{column.label} <span aria-hidden="true">{sort()?.key === column.key ? (sort()?.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button>
              </th>}</For></tr></thead>
              <tbody><For each={sortPulls(data().pulls, sort())}>{(pr: any) => <tr>
                <td style={cell}><button type="button" onClick={() => open(pr.url)} title={`${pr.repo} #${pr.number}: ${pr.title}`} style={{ cursor: 'pointer', 'text-align': 'left' }}><strong>#{pr.number}</strong> <small style={{ opacity: 0.65 }}>{pr.repo}</small> <span style={{ 'text-decoration': 'underline' }}>{pr.title || 'Title unavailable'}</span></button></td>
                <td style={{ ...cell, 'white-space': 'nowrap' }}><span style={{ color: statusColor(pr.status, ctx.appearance.mode()), 'font-weight': 600 }}>{pr.status}</span></td>
                <td style={{ ...cell, 'white-space': 'nowrap' }} title={pr.updatedAt}>{date(pr.updatedAt)}</td>
                <td style={cell} title="Issue discussion comments only">{pr.comments ?? '—'}</td>
              </tr>}</For></tbody>
            </table>
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
