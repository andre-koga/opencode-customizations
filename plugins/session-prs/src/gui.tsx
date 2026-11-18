import { Schema } from "effect"
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { Command, Contract, Ipc, MenuItem, Panel, Plugin } from "@opencode/plugin/gui"
import { Browser } from "@opencode/plugin/gui/browser"
import { makeReader, makePullReader, readPull, readReferencedPulls } from "./github.mjs"
import { createSessionCache } from "./session-cache.mjs"
import { combinePulls, statusColor } from "./display.mjs"
import { backendReadInput } from "./backend-schema.mjs"
import { focusSession } from "./navigation.mjs"

const Backend = Ipc.define({
  id: "session-prs.backend",
  methods: {
    read: { input: backendReadInput, output: Schema.Unknown },
  },
})
const NativePR = Contract.define("native-pr.open")

export default Plugin.define({
  setup(ctx) {
    console.info("[session-prs] window setup")
    const backend = ctx.main(Backend)
    const browser = ctx.use(Browser)
    const nativePR = ctx.use(NativePR)
    const tab = { id: "main", title: "Orchestrator", pinned: true, fallback: true }
    const [rows, setRows] = createSignal<any[]>([])
    const [message, setMessage] = createSignal("Loading sessions…")
    const [lastRefresh, setLastRefresh] = createSignal("")
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

      const cell = { padding: "8px 7px", "border-bottom": "1px solid #8883", "vertical-align": "top" }
      const ellipsis = { overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }
      function Status(props: { value: any }) {
        return <span style={{ color: statusColor(String(props.value ?? "")), "font-weight": "500" }}>{props.value ?? "—"}</span>
      }
      function SessionCell(props: { row: any, span: number }) {
        return <td rowSpan={props.span} style={{ ...cell, width: "200px", "max-width": "200px" }}>
          <button type="button" title={`Open chat: ${props.row.title}`} onClick={() => focusSession(ctx.sessions, ctx.tabs, props.row.key)} style={{ display: "block", width: "100%", cursor: "pointer", "text-align": "left" }}>
            <span style={{ ...ellipsis, display: "block", "text-decoration": "underline" }}>{props.row.title}</span>
            <small title={props.row.result?.branch || props.row.directory || "Location unavailable"} style={{ ...ellipsis, display: "block", opacity: 0.65 }}>{props.row.result?.branch || props.row.directory || "Location unavailable"}</small>
          </button>
          <Show when={props.row.result?.historyTruncated || props.row.result?.historyUnavailable || props.row.result?.historyIncomplete}><small style={{ opacity: 0.7 }}>{props.row.result?.historyUnavailable ? "Chat history unavailable" : props.row.result?.historyIncomplete ? "Chat history partially loaded" : "History limit reached"}</small></Show>
        </td>
      }
      return <div style={{ padding: "16px", overflow: "auto", height: "100%", "font-size": "13px" }}>
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px", "margin-bottom": "8px" }}>
          <div><strong>Orchestrator</strong><div style={{ opacity: 0.7, "font-size": "12px" }}>Open chats in this window</div></div>
          <button type="button" onClick={() => void cache.sync(ctx.sessions.list(), true)} style={{ cursor: "pointer", padding: "4px 8px", border: "1px solid currentColor", "border-radius": "5px" }}>Refresh</button>
        </div>
        <p style={{ opacity: 0.7, "font-size": "12px", "margin-bottom": "12px" }}>Shows the current branch and PRs linked in each chat. GitHub refreshes on completion or manually, at most once per minute. {lastRefresh()}</p>
        <Show when={!message()} fallback={<p>{message()}</p>}>
          <table style={{ width: "100%", "min-width": "850px", "table-layout": "fixed", "border-collapse": "collapse", "text-align": "left" }}>
            <colgroup><col style={{ width: "200px" }} /><col style={{ width: "385px" }} /><col style={{ width: "110px" }} /><col style={{ width: "85px" }} /><col style={{ width: "90px" }} /></colgroup>
            <thead><tr><For each={["Chat / branch", "Pull request", "Status", "CI", "Findings"]}>{(label) => <th style={{ padding: "7px", "border-bottom": "1px solid", opacity: 0.75, "white-space": "nowrap" }}>{label}</th>}</For></tr></thead>
            <tbody><For each={rows()}>{(row) => <Show when={row.result?.prs?.length} fallback={<tr><SessionCell row={row} span={1} /><td colSpan={4} style={cell}><span style={{ opacity: 0.7 }}>{row.result?.note || "Loading…"}</span></td></tr>}>
              <For each={row.result.prs}>{(pr: any, index) => <tr>
                <Show when={index() === 0}><SessionCell row={row} span={row.result.prs.length} /></Show>
                <td style={cell}><button type="button" title={`#${pr.number} ${pr.repo}: ${pr.title || "Title unavailable"}`} onClick={() => open(pr.url)} style={{ display: "flex", width: "100%", gap: "5px", "align-items": "baseline", cursor: "pointer", "text-align": "left" }}>
                  <strong style={{ "flex-shrink": 0 }}>#{pr.number}</strong>
                  <small style={{ ...ellipsis, "flex-shrink": 0, "max-width": "90px", opacity: 0.65, "font-size": "10px" }}>{pr.repo.split("/").pop()}</small>
                  <span style={{ ...ellipsis, "min-width": 0, "text-decoration": "underline" }}>{pr.title || "Title unavailable"}</span>
                </button></td>
                <For each={[pr.status, pr.ci]}>{(value) => <td style={{ ...cell, "white-space": "nowrap" }}><Status value={value} /></td>}</For>
                <td style={{ ...cell, "white-space": "nowrap" }} title={pr.findings?.outdated ? "Findings are from an earlier commit" : pr.findings ? "Findings from the bot's latest review of this commit" : "No recent bot review marker available"}>{pr.findings ? `${pr.findings.count}${pr.findings.outdated ? " (old)" : ""}` : "—"}</td>
              </tr>}</For>
            </Show>}</For></tbody>
          </table>
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
