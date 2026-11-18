import { Schema } from 'effect'
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import { Contract, Ipc, Panel, Plugin } from '@opencode/plugin/gui'
import { applyGithubAction, conversationCount, findingsSummary, makeReader, parsePullUrl, primaryAction } from './github.mjs'
import { confirmPrimaryAction } from './confirmation.mjs'
import { createViewCache } from './view-cache.mjs'
import { requestSanityCheck, sanityCheckPrompt } from './sanity-check.mjs'
import { openActionDraft, primaryActionPrompt } from './thread-action.mjs'
import { formatUpdatedTime } from './updated-time.mjs'
import { checkStatus } from './check-status.mjs'

const Navigation = Contract.define('native-pr.open')
const Backend = Ipc.define({
  // Changing the method set requires a new ID: the host caches IPC clients by ID.
  id: 'native-pr.backend-v3',
  methods: {
    read: { input: Schema.String, output: Schema.Unknown },
    refresh: { input: Schema.String, output: Schema.Unknown },
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
    const cache = createViewCache({ read: (url: string, options: { force: boolean }) => options.force ? backend.refresh(url) : backend.read(url) })
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
    const openPull = (session: any, url: string) => {
      const ref = parsePullUrl(url)
      if (!session || !ref) return false
      ctx.layout.open(`${ctx.id}:${encodeURIComponent(ref.url)}`, session)
      return true
    }
    ctx.provide(Navigation, { open: openPull })
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
      const load = async (force = false) => {
        const call = ++generation
        const target = url()
        setBusy(true); setError('')
        try {
          const result: any = await cache.load(target, { force })
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
            await active.server.client.session.prompt({ sessionID: active.id, delivery: 'queue', text: primaryActionPrompt(action, target) })
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
      const openNewThread = (kind: 'primary' | 'sanity') => {
        const current = data()
        if (!current || busy() || actionBusy() || sanityBusy()) return
        const target = current.ref.url
        const action = primaryAction(current)
        if (kind === 'sanity' ? action.kind !== 'ready' : !['conflict', 'blocked'].includes(action.kind)) return
        setError(''); setNotice('')
        try {
          const prompt = kind === 'sanity'
            ? sanityCheckPrompt({ url: target, headSha: current.pull.sha })
            : primaryActionPrompt(action, target)
          openActionDraft(ctx.layout, ctx.sessions.current(), prompt)
        } catch (err) {
          if (!disposed && url() === target) setError(err instanceof Error ? err.message : String(err))
        }
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
      const CheckRow = (p: { check: any }) => {
        const status = () => checkStatus(p.check)
        return <div class="native-pr-check">
          <span class={`native-pr-check-icon native-pr-check-${status().tone}`} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="8" cy="8" r="6.2" />
              <Show when={status().tone === 'success'}><path d="m5 8 2 2 4-4" /></Show>
              <Show when={status().tone === 'failure'}><path d="M8 4.5v4M8 11.2h.01" /></Show>
              <Show when={status().tone === 'pending'}><path d="M8 4.5V8l2.5 1.5" /></Show>
              <Show when={status().tone === 'neutral'}><path d="M5.5 8h5" /></Show>
            </svg>
          </span>
          <span class="native-pr-check-name">{p.check.name}</span>
          <span class={`native-pr-check-badge native-pr-check-${status().tone}`}>{status().label}</span>
        </div>
      }
      const SplitAction = (p: { label: string; disabled: boolean; color?: string; onAction: () => void; onDraft: () => void; draftLabel: string }) =>
        <div class={p.color ? 'native-pr-split native-pr-split-primary' : 'native-pr-split'} style={{ background: p.color || 'transparent', color: p.color ? '#fff' : 'inherit', opacity: p.disabled ? 0.65 : 1 }}>
          <button type="button" class="native-pr-split-action" disabled={p.disabled} onClick={p.onAction}>{p.label}</button>
          <button type="button" class="native-pr-split-caret" disabled={p.disabled} aria-label={p.draftLabel} title={`${p.draftLabel} to review and send`} onClick={p.onDraft}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
      return <div style={{ height: '100%', overflow: 'auto', padding: '18px', 'font-size': '13px', 'line-height': 1.5 }}>
        <style>{`
          .native-pr-split { display: inline-flex; align-items: stretch; border: 1px solid #8884; border-radius: 6px; overflow: hidden; }
          .native-pr-split button { display: inline-flex; align-items: center; justify-content: center; color: inherit; background: transparent; border: 0; border-radius: 0; cursor: pointer; font: inherit; line-height: inherit; }
          .native-pr-split button:not(:disabled):hover { background: #ffffff1a; }
          .native-pr-split button:focus-visible { outline: 2px solid currentColor; outline-offset: -3px; }
          .native-pr-split button:disabled { cursor: default; }
          .native-pr-split .native-pr-split-action { padding: 6px 10px; font-weight: 600; }
          .native-pr-split .native-pr-split-caret { width: 32px; border-left: 1px solid #8884; }
          .native-pr-split-primary .native-pr-split-caret { border-left-color: #ffffff40; }
          .native-pr-check-list { overflow: hidden; border: 1px solid #8884; border-radius: 8px; }
          .native-pr-check { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 10px 12px; background: #88808008; }
          .native-pr-check + .native-pr-check { border-top: 1px solid #8883; }
          .native-pr-check-icon { display: inline-flex; flex: none; }
          .native-pr-check-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
          .native-pr-check-badge { flex: none; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; line-height: 1.5; white-space: nowrap; }
          .native-pr-check-success { color: #70c58b; }
          .native-pr-check-pending { color: #e3b65f; }
          .native-pr-check-failure { color: #ee8585; }
          .native-pr-check-neutral { color: #aaa; }
          .native-pr-check-badge.native-pr-check-success { background: #23863622; }
          .native-pr-check-badge.native-pr-check-pending { background: #bb861b22; }
          .native-pr-check-badge.native-pr-check-failure { background: #cf343422; }
          .native-pr-check-badge.native-pr-check-neutral { background: #8882; }
          .native-pr-chain { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 6px; margin-top: 4px; color: #999; overflow-wrap: anywhere; }
          .native-pr-chain-link { padding: 0; border: 0; background: transparent; color: #7ea9ed; cursor: pointer; font: inherit; text-align: left; overflow-wrap: anywhere; }
          .native-pr-chain-link:hover { text-decoration: underline; }
          .native-pr-chain-link:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
        `}</style>
        <Show when={error()}><div role="alert" style={{ color: '#e27777', 'margin-bottom': '10px' }}>{error()}</div></Show>
        <Show when={notice()}><div role="status" style={{ color: '#70c58b', 'margin-bottom': '10px' }}>{notice()}</div></Show>
        <Show when={!data() && busy()}><p>Loading pull request…</p></Show>
        <Show when={data()}>{(d) => <>
          <div style={{ display: 'flex', 'align-items': 'start', gap: '10px', 'justify-content': 'space-between' }}>
            <div><div style={{ color: colors.muted }}>{d().ref.owner}/{d().ref.repo} #{d().ref.number}</div><h2 style={{ 'font-size': '19px', 'font-weight': 600, margin: '4px 0' }}>{d().pull.title}</h2><div style={{ color: colors.muted }}>{d().pull.state} · {d().pull.author}</div>
              <Show when={d().baseChain} fallback={<div class="native-pr-chain">{d().pull.head} → {d().pull.base}</div>}>{(baseChain) => <nav class="native-pr-chain" aria-label="Pull request base chain">
                <For each={baseChain().chain}>{(item: any) => <>
                  <button type="button" class="native-pr-chain-link" title={`Open PR #${item.number}`} onClick={() => {
                    if (!openPull(ctx.sessions.current(), item.url)) setError('No active OpenCode thread is available.')
                  }}>{item.branch} #{item.number}</button><span aria-hidden="true">→</span>
                </>}</For>
                <span>{baseChain().target}</span>
                <Show when={baseChain().status !== 'complete'}><span title="The chain could not be followed to the repository's default branch">({({ missing: 'no open PR', ambiguous: 'multiple PRs', unavailable: 'unavailable', cycle: 'cycle detected', limit: 'chain limit reached' } as Record<string, string>)[baseChain().status] || 'incomplete'})</span></Show>
              </nav>}</Show>
            </div>
            <div style={{ display: 'flex', gap: '6px', 'flex-shrink': 0 }}><button type="button" style={button} disabled={busy()} onClick={() => void load(true)}>{busy() ? 'Loading…' : 'Refresh'}</button><button type="button" style={button} onClick={() => ctx.system.openExternal(d().pull.url)}>Open on GitHub ↗</button></div>
          </div>
          <div style={{ color: colors.muted, 'margin-top': '5px' }} title="GitHub's last PR activity, including comments and metadata changes">
            <Show when={formatUpdatedTime(d().pull.updatedAt)} fallback="Last updated: unknown">{(updated) => <>Last updated {updated().relative} · {updated().absolute}</>}</Show>
          </div>
          <div style={{ color: colors.muted, 'font-size': '11px', 'margin-top': '5px' }}>{stamp()} · Refresh checks GitHub</div>
          <div style={{ 'margin-top': '14px', display: 'flex', 'align-items': 'center', gap: '10px', 'flex-wrap': 'wrap' }}>
            <Show when={['conflict', 'blocked'].includes(primaryAction(d()).kind)} fallback={
              <button type="button" disabled={busy() || actionBusy() || sanityBusy() || ['closed', 'pending', 'unknown'].includes(primaryAction(d()).kind)}
                style={{ ...button, 'font-weight': 600, color: '#fff', background: ({ draft: '#636b74', ready: '#238636', pending: '#805d1d', unknown: '#555', closed: '#555' } as Record<string, string>)[primaryAction(d()).kind], opacity: busy() || actionBusy() ? 0.65 : 1 }}
                onClick={() => void runPrimary()}>{actionBusy() ? 'Working…' : primaryAction(d()).label}</button>
            }>
              <SplitAction label={actionBusy() ? 'Working…' : primaryAction(d()).label} disabled={busy() || actionBusy() || sanityBusy()} color={primaryAction(d()).kind === 'conflict' ? '#946b06' : '#ab3535'} onAction={() => void runPrimary()} onDraft={() => openNewThread('primary')} draftLabel="Open this request in a new thread" />
            </Show>
            <Show when={primaryAction(d()).kind === 'ready'}>
              <SplitAction label={sanityBusy() ? 'Sending…' : 'Sanity check'} disabled={busy() || actionBusy() || sanityBusy()} onAction={() => void runSanityCheck()} onDraft={() => openNewThread('sanity')} draftLabel="Open sanity check in a new thread" />
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
              <Show when={(d().checks?.length || 0) + (d().statuses?.length || 0)} fallback={<p style={{ color: colors.muted }}>No checks reported in the available sections.</p>}><div class="native-pr-check-list"><For each={[...(d().checks ?? []), ...(d().statuses ?? [])]}>{(check: any) => <CheckRow check={check} />}</For></div></Show>
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
      refresh: (url) => read(url, { force: true }),
      async action(input) {
        try { await applyGithubAction(input) }
        finally { read.invalidate(input.url) }
      },
    })
    ctx.log.write('info', 'Native PR viewer started')
  },
})
