import { Schema } from "effect"
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { Command, Contract, Ipc, MenuItem, Panel, Plugin, Style } from "@opencode/plugin/gui"
import { Browser } from "@opencode/plugin/gui/browser"
import { makeReader, makePullReader, readPull, readReferencedPulls } from "./github.mjs"
import { createSessionCache } from "./session-cache.mjs"
import { combinePulls, visiblePulls } from "./display.mjs"
import { findingsStatus, statusLabel, statusTone } from '../../shared-ui/status.mjs'
import theme from '../../shared-ui/theme.css?inline'
import { backendId, backendReadInput } from "./backend-schema.mjs"
import { focusSession } from "./navigation.mjs"

const Backend = Ipc.define({
  id: backendId,
  methods: {
    read: { input: backendReadInput, output: Schema.Unknown },
  },
})
const NativePR = Contract.define("native-pr.open")

export default Plugin.define({
  setup(ctx) {
    ctx.add(Style, theme)
    console.info("[session-prs] window setup")
    const backend = ctx.main(Backend)
    const browser = ctx.use(Browser)
    const nativePR = ctx.use(NativePR)
    const tab = { id: "main", title: "Orchestrator", pinned: true, fallback: true }
    const [rows, setRows] = createSignal<any[]>([])
    const [message, setMessage] = createSignal("Loading sessions…")
    const [lastRefresh, setLastRefresh] = createSignal("")
    const [hideMerged, setHideMerged] = createSignal(false)
    const cache = createSessionCache({
      getRefs: () => ctx.sessions.list(),
      read: (input: any) => backend.read(input),
      update: (snapshot: any) => {
        setRows(snapshot.rows); setMessage(snapshot.message)
        if (snapshot.lastRefresh !== undefined) setLastRefresh(snapshot.lastRefresh)
      },
    })

    function openPanel() {
      const session = ctx.sessions.current()
      if (session) ctx.layout.open(`${ctx.id}:main`, session)
    }

    ctx.add(Command, () => ({ id: "open", title: "Open Orchestrator", keywords: "session prs github pull requests agents", run: openPanel }))
    ctx.add(MenuItem, () => ({ menu: "session.panel" as const, id: "open", title: "Orchestrator", icon: "github" as const, run: openPanel }))
    ctx.add(Panel, {
      id: "main",
      region: "side",
      wide: true,
      list: () => [tab],
      render: (props) => <Dashboard session={() => props.session} />,
    })

    function Dashboard(props: { session: () => any }) {
      createEffect(() => { void cache.syncIfNeeded(ctx.sessions.list()) })
      // While visible, refresh local session state; GitHub is only read on changes or manual refresh.
      const timer = setInterval(() => void cache.syncIfNeeded(ctx.sessions.list()), 10000)
      onCleanup(() => clearInterval(timer))

      function open(url: string) {
        const session = props.session()
        const native = nativePR()
        if (session && native.status === "active" && native.value.open(session, url)) return
        const live = browser()
        if (session && live.status === "active" && live.value.canOpen(session, url)) live.value.open(session, url)
        else ctx.system.openExternal(url)
      }

      const cell = {}
      const ellipsis = { overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }
      function Status(props: { value: any }) {
        return <span class="oc-badge" data-tone={statusTone(props.value)}>{statusLabel(props.value)}</span>
      }
      function SessionCell(props: { row: any, span: number }) {
        return <td rowSpan={props.span} style={{ ...cell, width: "200px", "max-width": "200px" }}>
          <button type="button" class="oc-link" title={`Open thread: ${props.row.title}`} onClick={() => focusSession(ctx.sessions, ctx.tabs, props.row.key)}>
            <span class="oc-link-title" style={ellipsis}>{props.row.title}</span>
            <span class="oc-link-meta" title={props.row.result?.branch || props.row.directory || "Location unavailable"} style={ellipsis}>{props.row.result?.branch || props.row.directory || "Location unavailable"}</span>
          </button>
          <Show when={props.row.result?.historyTruncated || props.row.result?.historyUnavailable || props.row.result?.historyIncomplete}><small class="oc-muted">{props.row.result?.historyUnavailable ? "Thread history unavailable" : props.row.result?.historyIncomplete ? "Thread history partially loaded" : "History limit reached"}</small></Show>
        </td>
      }
      return <div class="oc-panel" data-theme={ctx.appearance.mode()}>
        <div class="oc-toolbar">
          <div><h2 class="oc-title">Orchestrator</h2><div class="oc-meta" style={{ margin: '4px 0 0' }}>Open threads in this window</div></div>
          <div class="oc-actions">
            <button type="button" class="oc-tab" aria-pressed={hideMerged()} onClick={() => setHideMerged(!hideMerged())}>Hide merged</button>
            <button type="button" class="oc-button" onClick={() => void cache.sync(ctx.sessions.list(), true)}>Refresh</button>
          </div>
        </div>
        <p class="oc-meta">Current branch and linked PRs for each thread · 60-second GitHub cache{lastRefresh() ? ` · ${lastRefresh()}` : ''}</p>
        <Show when={!message()} fallback={<p class="oc-empty">{message()}</p>}>
          <div class="oc-table-wrap"><table class="oc-table" style={{ "min-width": "915px", "table-layout": "fixed" }}>
            <colgroup><col style={{ width: "200px" }} /><col style={{ width: "310px" }} /><col style={{ width: "145px" }} /><col style={{ width: "110px" }} /><col style={{ width: "150px" }} /></colgroup>
            <thead><tr><For each={["Thread / branch", "Pull request", "Status", "Checks", "Findings"]}>{(label) => <th scope="col">{label}</th>}</For></tr></thead>
            <tbody><For each={rows()}>{(row) => {
              const pulls = () => visiblePulls(row.result?.prs || [], hideMerged())
              return <Show when={pulls().length} fallback={<tr><SessionCell row={row} span={1} /><td colSpan={4} style={cell}><span style={{ opacity: 0.7 }}>{row.result?.prs?.length && hideMerged() ? "Merged PRs hidden" : row.result?.note || "Loading…"}</span></td></tr>}>
              <For each={pulls()}>{(pr: any, index) => <tr>
                <Show when={index() === 0}><SessionCell row={row} span={pulls().length} /></Show>
                <td><button type="button" class="oc-link" title={`#${pr.number} ${pr.repo}: ${pr.title || "Title unavailable"}`} onClick={() => open(pr.url)}>
                  <span class="oc-link-title" style={ellipsis}>{pr.title || "Title unavailable"}</span>
                  <span class="oc-link-meta">{pr.repo.split("/").pop()} · #{pr.number}</span>
                </button></td>
                <For each={[pr.status, pr.ci]}>{(value) => <td style={{ ...cell, "white-space": "nowrap" }}><Status value={value} /></td>}</For>
                <td title={pr.findings?.outdated ? "Findings are from an earlier commit" : pr.findings ? "Findings from the bot's latest review of this commit" : "No recent bot review marker available"}><span class="oc-badge" data-tone={findingsStatus(pr.findings).tone}>{findingsStatus(pr.findings).label}</span></td>
              </tr>}</For>
            </Show>}}</For></tbody>
          </table></div>
        </Show>
      </div>
    }
    return () => cache.dispose()
  },
  main(ctx) {
    const readPR = makePullReader()
    const read = makeReader({ readFn: (info, directory) => readPull(info, directory, (ref, cwd) => readPR(`https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`, cwd)) })
    ctx.provide(Backend, {
      read: async ({ directory, directories = [], urls = [] }) => {
        let branch: any = { data: {}, cached: false, checkedAt: Date.now() }
        if (directory) {
          try { branch = await read(directory) }
          catch { branch.data = { note: "Branch lookup unavailable" } }
        }
        const pastDirectories = [...new Set(directories)].filter((item) => item && item !== directory).slice(0, 20)
        const previous: any[] = new Array(pastDirectories.length)
        let next = 0
        async function worker() {
          while (next < pastDirectories.length) {
            const index = next++
            try { previous[index] = (await read(pastDirectories[index])).data.pr }
            catch { /* A past worktree may have been removed. Linked PRs still work. */ }
          }
        }
        const [referenced] = await Promise.all([
          readReferencedPulls(urls.slice(0, 100), readPR, directory),
          ...Array.from({ length: Math.min(4, pastDirectories.length) }, worker),
        ])
        const prs = combinePulls(branch.data.pr, [...previous, ...referenced])
        // Preserve the old single-PR shape while older windows finish reloading.
        return { ...branch, data: { branch: branch.data.branch, pr: branch.data.pr, note: branch.data.note || (directory ? "No PR yet" : "No linked PRs"), prs } }
      },
    })
    ctx.log.write("info", "Orchestrator loaded")
  },
})
