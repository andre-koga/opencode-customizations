import { Schema } from 'effect'
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import { Contract, Ipc, Panel, Plugin } from '@opencode/plugin/gui'
import { applyGithubAction, conversationCount, findingsSummary, makeReader, parsePullUrl, primaryAction } from './github.mjs'
import { confirmPrimaryAction } from './confirmation.mjs'
import { createViewCache } from './view-cache.mjs'
import { requestSanityCheck } from './sanity-check.mjs'

const Navigation = Contract.define('native-pr.open')
const Backend = Ipc.define({
  // Changing the method set requires a new ID: the host caches IPC clients by ID.
  id: 'native-pr.backend-v2',
  methods: {
    read: { input: Schema.String, output: Schema.Unknown },
    action: { input: Schema.Struct({ url: Schema.String, action: Schema.String, expectedHead: Schema.String }) },
  },
})

const colors = { border: '#8884', muted: '#999', accent: '#7ea9ed' }
const button = { cursor: 'pointer', background: 'transparent', color: 'inherit', border: `1px solid ${colors.border}`, 'border-radius': '6px', padding: '6px 10px' }
const section = { border: `1px solid ${colors.border}`, 'border-radius': '8px', padding: '12px', 'margin-bottom': '10px' }
const wrap = { 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere' }

export default Plugin.define({
  setup(ctx) {
    const backend = ctx.main(Backend)
    const cache = createViewCache({ read: (url: string) => backend.read(url) })
    const tabs = new Map<string, { id: string; title: string; closable: 'compact' }>()
    const tabFor = (id: string) => {
      const existing = tabs.get(id)
      if (existing) return existing
      let ref = null
      try { ref = parsePullUrl(decodeURIComponent(id)) } catch { /* invalid stored tab */ }
      if (!ref) return undefined
      const tab = { id, title: `${ref.repo} #${ref.number}`, closable: 'compact' as const }
      tabs.set(id, tab)
      return tab
    }
    ctx.provide(Navigation, {
      open(session, url: string) {
        const ref = parsePullUrl(url)
        if (!session || !ref) return false
        ctx.layout.open(`${ctx.id}:${encodeURIComponent(ref.url)}`, session)
        return true
      },
    })
    ctx.add(Panel, {
      id: 'pull', region: 'side', wide: true,
      list: ({ open }) => open.map(tabFor).filter(Boolean),
      render: (props) => <PullView tab={() => props.tab} />,
    })

    function PullView(props: { tab: () => { id: string } }) {
      const [data, setData] = createSignal<any>()
      const [error, setError] = createSignal('')
      const [busy, setBusy] = createSignal(false)
      const [view, setView] = createSignal('Overview')
      const [stamp, setStamp] = createSignal('')
      const [actionBusy, setActionBusy] = createSignal(false)
      const [sanityBusy, setSanityBusy] = createSignal(false)
      const [notice, setNotice] = createSignal('')
      let generation = 0
      let disposed = false
      const url = () => { try { return decodeURIComponent(props.tab().id) } catch { return '' } }
      const display = (result: any) => {
        setData(result.data)
        setStamp(`${result.cached ? 'Cached' : 'Checked'} ${new Date(result.checkedAt).toLocaleTimeString()}`)
      }
      const load = async () => {
        const call = ++generation
        const target = url()
        setBusy(true); setError('')
        try {
          const result: any = await cache.load(target)
          if (disposed || call !== generation) return
          display(result)
        } catch (err) {
          if (!disposed && call === generation) setError(err instanceof Error ? err.message : String(err))
        } finally { if (!disposed && call === generation) setBusy(false) }
      }
      createEffect(() => {
        props.tab().id
        generation++; setView('Overview'); setNotice(''); setError(''); setBusy(false)
        const cached = cache.get(url())
        if (cached) display(cached)
        else { setData(undefined); setStamp('') }
        if (!cached?.fresh) void load()
      })
      onCleanup(() => { disposed = true; generation++ })
      const runPrimary = async () => {
        const current = data()
        if (!current || actionBusy() || sanityBusy()) return
        const action = primaryAction(current)
        const state = action.kind
        const target = current.ref.url
        setActionBusy(true); setError(''); setNotice('')
        try {
          if (state === 'conflict' || state === 'blocked') {
            const active = ctx.sessions.current()
            if (!active) throw new Error('No active OpenCode thread is available.')
            const task = state === 'conflict'
              ? 'Investigate and resolve the merge conflicts for'
              : action.task || 'Investigate and address merge blockers for'
            await active.server.client.session.prompt({ sessionID: active.id, delivery: 'queue', text: `${task} ${target}. Verify the current PR status, follow repository and worktree instructions, and do not merge the PR.` })
            if (!disposed) setNotice('Request sent to the active thread.')
            return
          }
          if (state !== 'ready' && state !== 'draft') return
          const isMerge = state === 'ready'
          const confirmed = await confirmPrimaryAction(state, current, (options) => ctx.dialogs.confirm(options))
          if (!confirmed || disposed) return
          if (url() !== target) throw new Error('The selected pull request changed. Try again from its panel.')
          try { await backend.action({ url: target, action: isMerge ? 'merge' : 'ready', expectedHead: current.pull.sha }) }
          finally { cache.invalidate(target) }
          if (!disposed && url() === target) { setNotice(isMerge ? 'Pull request merged.' : 'Pull request marked ready for review.'); await load() }
        } catch (err) {
          if (!disposed && url() === target) setError(err instanceof Error ? err.message : String(err))
        } finally { if (!disposed) setActionBusy(false) }
      }
      const runSanityCheck = async () => {
        const current = data()
        if (!current || busy() || actionBusy() || sanityBusy() || primaryAction(current).kind !== 'ready') return
        const target = current.ref.url
        setSanityBusy(true); setError(''); setNotice('')
        try {
          await requestSanityCheck(ctx.sessions.current(), { url: target, headSha: current.pull.sha })
          if (!disposed && url() === target) setNotice('Sanity check requested in the active thread.')
        } catch (err) {
          if (!disposed && url() === target) setError(err instanceof Error ? err.message : String(err))
        } finally { if (!disposed) setSanityBusy(false) }
      }
      const conversation = () => {
        const d = data()
        if (!d) return []
        return [
          ...(d.comments ?? []).map((x: any) => ({ ...x, type: 'Comment' })),
          ...(d.inline ?? []).map((x: any) => ({ ...x, type: 'Inline review' })),
          ...(d.reviews ?? []).filter((x: any) => x.body || ['APPROVED', 'CHANGES_REQUESTED'].includes(x.state)).map((x: any) => ({ ...x, type: x.state?.replaceAll('_', ' ') || 'Review' })),
        ].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      }
      const SectionError = () => <div style={{ color: colors.muted }}>This section could not be loaded. Check repository access.</div>
      return <div style={{ height: '100%', overflow: 'auto', padding: '18px', 'font-size': '13px', 'line-height': 1.5 }}>
        <Show when={error()}><div role="alert" style={{ color: '#e27777', 'margin-bottom': '10px' }}>{error()}</div></Show>
        <Show when={notice()}><div role="status" style={{ color: '#70c58b', 'margin-bottom': '10px' }}>{notice()}</div></Show>
        <Show when={!data() && busy()}><p>Loading pull request…</p></Show>
        <Show when={data()}>{(d) => <>
          <div style={{ display: 'flex', 'align-items': 'start', gap: '10px', 'justify-content': 'space-between' }}>
            <div><div style={{ color: colors.muted }}>{d().ref.owner}/{d().ref.repo} #{d().ref.number}</div><h2 style={{ 'font-size': '19px', 'font-weight': 600, margin: '4px 0' }}>{d().pull.title}</h2><div style={{ color: colors.muted }}>{d().pull.state} · {d().pull.author} · {d().pull.head} → {d().pull.base}</div></div>
            <div style={{ display: 'flex', gap: '6px', 'flex-shrink': 0 }}><button type="button" style={button} disabled={busy()} onClick={() => void load()}>{busy() ? 'Loading…' : 'Refresh'}</button><button type="button" style={button} onClick={() => ctx.system.openExternal(d().pull.url)}>Open on GitHub ↗</button></div>
          </div>
          <div style={{ color: colors.muted, 'font-size': '11px', 'margin-top': '5px' }}>{stamp()} · refresh uses a 60-second cache</div>
          <div style={{ 'margin-top': '14px', display: 'flex', 'align-items': 'center', gap: '10px', 'flex-wrap': 'wrap' }}>
            <button type="button" disabled={busy() || actionBusy() || sanityBusy() || ['closed', 'pending', 'unknown'].includes(primaryAction(d()).kind)}
              style={{ ...button, 'font-weight': 600, color: '#fff', background: ({ draft: '#636b74', conflict: '#946b06', blocked: '#ab3535', ready: '#238636', pending: '#555', unknown: '#555', closed: '#555' } as Record<string, string>)[primaryAction(d()).kind], opacity: busy() || actionBusy() ? 0.65 : 1 }}
              onClick={() => void runPrimary()}>{actionBusy() ? 'Working…' : primaryAction(d()).label}</button>
            <Show when={primaryAction(d()).kind === 'ready'}>
              <button type="button" style={button} disabled={busy() || actionBusy() || sanityBusy()} onClick={() => void runSanityCheck()}>{sanityBusy() ? 'Sending…' : 'Sanity check'}</button>
              <span style={{ color: colors.muted }}>Merge commit · confirmation required</span>
            </Show>
            <Show when={primaryAction(d()).kind === 'unknown'}><span style={{ color: colors.muted }}>Refresh when GitHub has finished calculating status.</span></Show>
          </div>
          <div style={{ display: 'flex', gap: '5px', 'border-bottom': `1px solid ${colors.border}`, 'margin': '16px 0 12px', 'padding-bottom': '8px', 'flex-wrap': 'wrap' }}>
            <For each={['Overview', 'Conversation', 'Checks', 'Files']}>{(name) => <button type="button" style={{ ...button, 'border-color': view() === name ? colors.accent : colors.border }} onClick={() => setView(name)}>{name === 'Conversation' ? `Conversation (${conversationCount(d())})` : name}</button>}</For>
            <span title={findingsSummary(d()).detail} style={{ display: 'inline-flex', 'align-items': 'center', padding: '6px 10px', color: colors.muted }}>Findings ({findingsSummary(d()).label})</span>
          </div>
          <Show when={view() === 'Overview'}><div style={section}><strong>Description</strong><div style={{ ...wrap, 'margin-top': '8px' }}>{d().pull.body || 'No description.'}</div></div><div style={{ color: colors.muted }}>Changed files: {d().pull.changedFiles} · +{d().pull.additions} / −{d().pull.deletions}</div></Show>
          <Show when={view() === 'Conversation'}>
            <Show when={d().comments === null || d().inline === null || d().reviews === null}><SectionError /></Show>
            <Show when={d().comments !== null || d().inline !== null || d().reviews !== null}>
              <Show when={conversation().length} fallback={<p style={{ color: colors.muted }}>No comments or submitted reviews.</p>}><For each={conversation()}>{(item: any) => <article style={section}><div><strong>{item.author}</strong> <span style={{ color: colors.muted }}>· {item.type}{item.date ? ` · ${new Date(item.date).toLocaleString()}` : ''}</span></div><Show when={item.path}><div style={{ color: colors.muted, 'margin-top': '5px' }}>{item.path}{item.line ? `:${item.line}` : ''}</div></Show><Show when={item.diff}><pre style={{ ...wrap, 'font-size': '11px', padding: '8px', background: '#8881' }}>{item.diff}</pre></Show><div style={{ ...wrap, 'margin-top': '6px' }}>{item.body}</div></article>}</For></Show>
              <Show when={d().limited.some((x: string) => ['comments', 'inline', 'reviews'].includes(x))}><p style={{ color: colors.muted }}>Showing at most 100 items per category.</p></Show>
            </Show>
          </Show>
          <Show when={view() === 'Checks'}>
            <Show when={d().checks === null || d().statuses === null}><SectionError /></Show>
            <Show when={d().checks !== null || d().statuses !== null}>
              <Show when={(d().checks?.length || 0) + (d().statuses?.length || 0)} fallback={<p style={{ color: colors.muted }}>No checks reported in the available sections.</p>}><For each={[...(d().checks ?? []), ...(d().statuses ?? [])]}>{(check: any) => <div style={{ ...section, display: 'flex', 'justify-content': 'space-between', gap: '12px' }}><span>{check.name}</span><span style={{ color: colors.muted }}>{check.conclusion || check.status}</span></div>}</For></Show>
              <Show when={d().limited.includes('checks') || d().limited.includes('statuses')}><p style={{ color: colors.muted }}>Showing at most 100 checks per category.</p></Show>
            </Show>
          </Show>
          <Show when={view() === 'Files'}>
            <Show when={d().files !== null} fallback={<SectionError />}>
              <Show when={d().files.length} fallback={<p style={{ color: colors.muted }}>No files changed.</p>}><For each={d().files}>{(file: any) => <details style={section}><summary style={{ cursor: 'pointer', 'overflow-wrap': 'anywhere' }}>{file.name} <span style={{ color: colors.muted }}>· {file.status} · +{file.additions} / −{file.deletions}</span></summary><Show when={file.patch} fallback={<p style={{ color: colors.muted }}>Diff unavailable (binary or too large).</p>}><pre style={{ 'white-space': 'pre', overflow: 'auto', 'font-size': '11px', padding: '10px', background: '#8881' }}>{file.patch}</pre></Show></details>}</For></Show>
              <Show when={d().limited.includes('files')}><p style={{ color: colors.muted }}>Showing at most 100 changed files.</p></Show>
            </Show>
          </Show>
        </>}</Show>
      </div>
    }
  },
  main(ctx) {
    const read = makeReader()
    ctx.provide(Backend, {
      read: (url) => read(url),
      async action(input) {
        try { await applyGithubAction(input) }
        finally { read.invalidate(input.url) }
      },
    })
    ctx.log.write('info', 'Native PR viewer started')
  },
})
