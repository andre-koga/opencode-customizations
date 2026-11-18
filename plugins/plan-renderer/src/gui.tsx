import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js'
import { Command, LinkHandler, Panel, Plugin } from '@opencode/plugin/gui'
import { buildPlan, isPlanPath, taskProgress } from './plan.mjs'

export default Plugin.define({
  setup(ctx) {
    const tabs = new Map<string, any>()
    const parse = (id: string) => {
      try { const path = decodeURIComponent(id); return isPlanPath(path) ? path : undefined } catch { return undefined }
    }
    const tabFor = (id: string) => {
      const path = parse(id)
      if (!path) return undefined
      if (!tabs.has(id)) tabs.set(id, { id, title: path.split('/').pop(), file: path, closable: 'compact' as const })
      return tabs.get(id)
    }
    const resolve = (href: string, base?: string) => {
      const screen = ctx.screen.current()
      if (!screen) return undefined
      const candidate = base && !href.startsWith('/') && !href.startsWith('file:') && !href.startsWith('.opencode/') ? `${base}/${href}` : href
      const path = screen.file.resolve(candidate)
      return isPlanPath(path) && !screen.file.absolute(path) ? path : undefined
    }
    const open = (path: string, session: any, background = false) => {
      ctx.layout.open(`${ctx.id}:${encodeURIComponent(path)}`, session, { tab: 'select', background })
    }

    ctx.add(LinkHandler, {
      priority: 20,
      match: (link) => !!link.session && link.session.key === ctx.sessions.current()?.key && !!resolve(link.href, link.base),
      exists: async (link) => {
        const path = resolve(link.href, link.base)
        try { return path ? await ctx.screen.current()?.file.exists(path) ?? false : false } catch { return false }
      },
      open: (link) => { const path = resolve(link.href, link.base); if (path && link.session) open(path, link.session, link.background) },
    })
    ctx.add(Command, () => ({
      id: 'open', title: 'Open plan renderer', keywords: 'plan markdown build checklist',
      enabled: !!ctx.sessions.current(),
      run: async () => {
        const session = ctx.sessions.current()
        if (!session) return
        const input = await ctx.dialogs.prompt({ title: 'Open plan', placeholder: '.opencode/plans/plan-name.md' })
        if (!input || ctx.sessions.current()?.key !== session.key) return
        const path = resolve(input.trim())
        if (!path) { ctx.toast.show({ variant: 'error', title: 'Choose a Markdown file in .opencode/plans' }); return }
        open(path, session)
      },
    }))
    ctx.add(Panel, {
      id: 'plan', region: 'side', wide: true,
      list: ({ open: ids }) => ids.map(tabFor).filter(Boolean),
      render: (props) => <PlanView tab={() => props.tab} session={() => props.session} screen={props.screen} />,
    })

    function PlanView(props: { tab: () => any; session: () => any; screen: any }) {
      const [busy, setBusy] = createSignal(false)
      const [error, setError] = createSignal('')
      const path = () => parse(props.tab().id)
      createEffect(() => {
        const current = path()
        if (!current) return
        void props.screen.file.sync(current).catch(() => {})
        onCleanup(() => props.screen.file.unwatch(current))
      })
      const file = () => { const current = path(); return current ? props.screen.file.get(current) : undefined }
      const text = () => file()?.content?.type === 'text' ? file().content.content as string : undefined
      const progress = createMemo(() => taskProgress(text() || ''))
      async function start() {
        const current = path(), session = props.session()
        if (!current || !session || text() === undefined || busy()) return
        setBusy(true); setError('')
        try { await buildPlan(session, props.screen.file.root, current) }
        catch (err) { setError(err instanceof Error ? err.message : String(err)) }
        finally { setBusy(false) }
      }
      return <div style={{ height: '100%', overflow: 'auto', padding: '22px' }}>
        <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', gap: '16px', 'flex-wrap': 'wrap', 'margin-bottom': '20px' }}>
          <div><strong>Plan progress</strong><div style={{ opacity: 0.7, 'margin-top': '4px' }}>{progress().done} of {progress().total} tasks complete</div></div>
          <ctx.ui.Button type="button" variant="contrast" size="large" disabled={busy() || text() === undefined} busy={busy()} onClick={() => void start()}>{busy() ? 'Starting…' : 'Build'}</ctx.ui.Button>
        </div>
        <Show when={error()}><p role="alert" style={{ color: '#e27777' }}>{error()}</p></Show>
        <Show when={text() !== undefined} fallback={<p>{file()?.error || (file()?.notFound ? 'Plan not found.' : 'Loading plan…')}</p>}>
          <ctx.ui.Markdown text={text() || ''} />
        </Show>
      </div>
    }
  },
})
