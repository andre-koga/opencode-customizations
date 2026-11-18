import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { Command, Contract, LinkHandler, Panel, Plugin, Style } from '@opencode/plugin/gui'
import { buildPlan, isPlanPath, openTaskPullRequest, stagePlanQuestion } from './plan.mjs'
import { parsePlan, planProgress, TASK_STATUSES } from './plan-format.mjs'
import css from './panel.css?inline'

const NativePR = Contract.define('native-pr.open')

export default Plugin.define({
  setup(ctx) {
    const nativePR = ctx.use(NativePR)
    ctx.add(Style, css)
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
      const panelId = `plan-panel-${crypto.randomUUID()}`
      const [busy, setBusy] = createSignal(false)
      const [error, setError] = createSignal('')
      const [notice, setNotice] = createSignal('')
      const [view, setView] = createSignal('goal')
      const [filter, setFilter] = createSignal('all')
      let generation = 0, disposed = false
      const path = () => parse(props.tab().id)
      createEffect(() => {
        const current = path(), session = props.session()
        session?.key
        generation++; setView('goal'); setFilter('all'); setError(''); setNotice(''); setBusy(false)
        if (!current) return
        void props.screen.file.sync(current).catch(() => {})
        onCleanup(() => props.screen.file.unwatch(current))
      })
      onCleanup(() => { disposed = true; generation++ })
      const file = () => { const current = path(); return current ? props.screen.file.get(current) : undefined }
      const text = () => file()?.content?.type === 'text' ? file().content.content as string : undefined
      const plan = createMemo(() => parsePlan(text() || ''))
      const revisionIdentity = createMemo(() => `${plan().metadata['plan-id'] || ''}:${plan().metadata.revision || ''}`)
      createEffect(() => {
        revisionIdentity()
        // A material revision or replacement invalidates pending dialogs/notices.
        generation++; setNotice(''); setError(''); setBusy(false)
      })
      const progress = createMemo(() => planProgress(plan()))
      const active = () => !!props.session() && props.session().key === ctx.sessions.current()?.key
      const valid = () => plan().valid && path() === `.opencode/plans/${plan().metadata['plan-id']}.md`
      const navigation = createMemo(() => [{ id: 'all', title: 'All' }, ...plan().sections])
      const selected = () => plan().sections.find((section: any) => section.id === view())
      const visibleTasks = () => plan().tasks.filter((task: any) => filter() === 'all' || task.status === filter())
      const groups = () => [...new Set(visibleTasks().map((task: any) => task.group))]
      const diagnostics = () => [...plan().diagnostics, ...(plan().standard && path() !== `.opencode/plans/${plan().metadata['plan-id']}.md` ? [{ message: 'Active filename must match plan-id.' }] : [])]
      createEffect(() => {
        // Old plans stay readable; never hide unmatched sections or rewrite them on load.
        if (text() !== undefined && !navigation().some((item: any) => item.id === view())) setView('all')
      })
      function navigateKey(event: KeyboardEvent) {
        const items = navigation(), index = items.findIndex((item: any) => item.id === view())
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : event.key === 'ArrowRight' ? (index + 1) % items.length
          : event.key === 'ArrowLeft' ? (index - 1 + items.length) % items.length : -1
        if (target < 0) return
        event.preventDefault(); setView(items[target].id)
        const buttons = event.currentTarget instanceof HTMLElement ? event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]') : []
        buttons[target]?.focus()
      }
      async function start() {
        const current = path(), session = props.session()
        if (!current || !active() || !valid() || text() === undefined || busy()) return
        const call = generation
        setBusy(true); setError('')
        try { await buildPlan(session, props.screen.file.root, current, text()); if (!disposed && call === generation) setNotice('Build requested in this chat.') }
        catch (err) { if (!disposed && call === generation) setError(err instanceof Error ? err.message : String(err)) }
        finally { if (!disposed && call === generation) setBusy(false) }
      }
      async function ask(task?: any, section?: any, preset?: string) {
        const current = path(), session = props.session(), root = props.screen.file.root, call = generation
        if (!current || !active()) return
        try {
          const question = preset || await ctx.dialogs.prompt({ title: task ? `Ask about ${task.id}` : `Ask about ${section?.title || 'this plan'}`, placeholder: 'What would you like to understand or change?' })
          if (!question || disposed || call !== generation || !active() || props.session().key !== session.key) return
          // Re-read after a dialog so we quote the current item, not a stale completion state.
          const latestTask = task ? plan().tasks.find((item: any) => item.id === task.id) : undefined
          const latestSection = section ? plan().sections.find((item: any) => item.id === section.id) : undefined
          if ((task && !latestTask) || (section && !latestSection)) throw new Error('The selected item changed; select it again.')
          stagePlanQuestion(props.screen.composer, { root, path: current, plan: plan(), task: latestTask, section: latestSection, question })
          setNotice('Question added to the composer. Review it and send when ready.')
        } catch (err) { if (!disposed && call === generation) setError(err instanceof Error ? err.message : String(err)) }
      }
      function openPR(event: MouseEvent, href: string) {
        // Modified clicks retain normal browser link behavior.
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault(); event.stopPropagation()
        if (!active()) { setError('Switch to this plan’s chat before opening its pull request.'); return }
        try { openTaskPullRequest(nativePR, props.session(), href, (url: string) => ctx.system.openExternal(url)) }
        catch (err) { setError(err instanceof Error ? err.message : String(err)) }
      }
      const Checklist = () => <div class="plan-checklist">
        <div class="plan-toolbar">
          <h2>Checklist</h2>
          <label>Show <select aria-label="Filter tasks by status" value={filter()} onChange={(event) => setFilter(event.currentTarget.value)}>
            <option value="all">All tasks ({plan().tasks.length})</option>
            <For each={TASK_STATUSES}>{(status) => <option value={status}>{status} ({progress().counts[status]})</option>}</For>
          </select></label>
        </div>
        <Show when={visibleTasks().length} fallback={<p class="plan-muted">No tasks match this filter.</p>}>
          <For each={groups()}>{(group) => <section aria-label={String(group)}>
            <h3>{group}</h3>
            <For each={visibleTasks().filter((task: any) => task.group === group)}>{(task: any) => <article class="plan-task" data-status={task.status}>
              <div class="plan-task-heading">
                <span class="plan-task-state" aria-label={`Status: ${task.status}`}>{task.status === 'done' ? '✓' : task.status === 'blocked' ? '!' : task.status === 'in-progress' ? '◐' : ['cancelled', 'superseded'].includes(task.status) ? '–' : '○'}</span>
                <strong><span class="plan-muted">{task.id}</span> {task.title}</strong>
                <span class="plan-status">{task.status}</span>
              </div>
              <div class="plan-task-details">
                <Show when={task.fields['Depends on'] && task.fields['Depends on'] !== 'none'}><p><strong>Depends on:</strong> {task.fields['Depends on']}</p></Show>
                <Show when={task.fields.Verification}><p><strong>Verification:</strong> {task.fields.Verification}</p></Show>
                <Show when={task.fields.Notes && task.fields.Notes !== 'none'}><ctx.ui.Markdown text={`**Notes:** ${task.fields.Notes}`} /></Show>
                <Show when={task.status === 'done' && !task.prs.length}><p class="plan-muted">{task.fields.PRs?.startsWith('not applicable') ? `PR: ${task.fields.PRs}` : 'No PR linked — completion evidence needs review.'}</p></Show>
              </div>
              <div class="plan-task-actions">
                <For each={task.prs}>{(pr: any) => <a href={pr.url} onClick={(event) => openPR(event, pr.url)}>{pr.label} ↗</a>}</For>
                <button type="button" disabled={!active()} aria-label={`Ask about ${task.id}`} onClick={() => void ask(task)}>Ask</button>
                <button type="button" disabled={!active()} aria-label={`Explain ${task.id}`} onClick={() => void ask(task, undefined, 'Explain the purpose, approach, dependencies, and verification for this task. Do not execute work or change the plan.')}>Explain</button>
                <Show when={task.status === 'done'}><button type="button" disabled={!active()} aria-label={`Review evidence for ${task.id}`} onClick={() => void ask(task, undefined, 'Review whether the cited PRs and verification evidence justify marking this task done. Report gaps; do not modify status or execute work without discussing it.')}>Review evidence</button></Show>
              </div>
            </article>}</For>
          </section>}</For>
        </Show>
      </div>
      return <div class="plan-renderer">
        <header class="plan-header">
          <div class="plan-toolbar">
            <div><strong>{plan().title}</strong><div class="plan-muted">{plan().standard ? `Revision ${plan().metadata.revision || '?'} · ${plan().metadata.status || 'unknown'} · ` : 'Nonstandard plan · '}{progress().done} of {progress().total} active tasks done<Show when={progress().retired}> · {progress().retired} retired</Show></div></div>
            <ctx.ui.Button type="button" variant="contrast" size="large" disabled={busy() || text() === undefined || !active() || !valid()} busy={busy()} onClick={() => void start()}>{busy() ? 'Starting…' : 'Build'}</ctx.ui.Button>
          </div>
          <progress aria-label="Active task completion" max={Math.max(1, progress().total)} value={progress().done} />
          <div class="plan-tabs" role="tablist" aria-label="Plan sections" onKeyDown={navigateKey}>
            <For each={navigation()}>{(item: any) => <button type="button" role="tab" id={`${panelId}-${item.id}`} aria-controls={panelId} aria-selected={view() === item.id} tabIndex={view() === item.id ? 0 : -1} onClick={() => setView(item.id)}>{item.title}</button>}</For>
          </div>
        </header>
        <div class="plan-body" role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${view()}`}>
        <Show when={error()}><p role="alert" class="plan-error">{error()}</p></Show>
        <Show when={notice()}><p role="status" class="plan-muted">{notice()}</p></Show>
        <Show when={text() !== undefined} fallback={<p>{file()?.error || (file()?.notFound ? 'Plan not found.' : 'Loading plan…')}</p>}>
          <Show when={!valid()}><div class="plan-warning" role="status">
            <strong>{plan().standard ? 'Plan format needs attention' : 'This plan predates the standard format'}</strong>
            <p>Source is preserved. Build is disabled until the plan is normalized and validated.</p>
            <Show when={diagnostics().length}><ul><For each={diagnostics()}>{(item: any) => <li>{item.line ? `Line ${item.line}: ` : ''}{item.message}</li>}</For></ul></Show>
            <button type="button" disabled={!active()} onClick={() => void ask(undefined, undefined, 'Normalize this plan using ~/.config/opencode/plugins/plan-renderer/PLAN_FORMAT.md. Snapshot its exact current contents first; preserve all ideas, decisions, task IDs/progress, PRs, and verification. Do not implement the plan. Validate after normalization.')}>Prepare normalization request</button>
          </div></Show>
          <Show when={view() === 'all'} fallback={<Show when={view() === 'checklist'} fallback={<>
            <div class="plan-section-actions"><button type="button" disabled={!active() || !selected()} onClick={() => void ask(undefined, selected())}>Ask about {selected()?.title || 'section'}</button></div>
            <ctx.ui.Markdown text={selected()?.markdown || ''} />
          </>}><Checklist /></Show>}>
            <ctx.ui.Markdown text={text() || ''} />
          </Show>
        </Show>
        </div>
      </div>
    }
  },
})
