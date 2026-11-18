import { Schema } from "effect"
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { Command, Contract, Ipc, MenuItem, Panel, Plugin } from "@opencode/plugin/gui"
import { Browser } from "@opencode/plugin/gui/browser"
import { makeReader, makePullReader, readPull, readReferencedPulls } from "./github.mjs"
import { sessionPullReferences } from "./session-refs.mjs"
import { combinePulls, statusColor } from "./display.mjs"

const Backend = Ipc.define({
  id: "session-prs.backend",
  methods: {
    read: { input: Schema.Struct({ directory: Schema.String, directories: Schema.Array(Schema.String), urls: Schema.Array(Schema.String) }), output: Schema.Unknown },
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
      const [rows, setRows] = createSignal<any[]>([])
      const [message, setMessage] = createSignal("Loading sessions…")
      const [lastRefresh, setLastRefresh] = createSignal("")
      const previous = new Map<string, { active: boolean; directory: string }>()
      const results = new Map<string, any>()
      const delayed = new Map<string, ReturnType<typeof setTimeout>>()
      let disposed = false
      let busy = false
      let refreshRequested = false
      const deferredKeys = new Set<string>()

      async function sync(refs: any[], manual = false, onlyKey?: string) {
        if (busy) {
          if (manual && onlyKey) deferredKeys.add(onlyKey)
          else refreshRequested ||= manual
          return
        }
        busy = true
        try {
          const servers = [...new Set(refs.map((ref) => ref.server))] as any[]
          const active = new Map(await Promise.all(servers.map(async (server) => {
            try { return [server, await server.client.session.active()] as const }
            catch { return [server, null] as const }
          })))
          const sessions = await Promise.all(refs.map(async (ref) => {
            try {
              const info = await ref.server.client.session.get({ sessionID: ref.id })
              const running = active.get(ref.server)
              return { key: ref.key, id: ref.id, title: info.title || ref.id, directory: info.location?.directory, local: ref.server.local, active: running ? !!running[ref.id] : null, outcome: info.outcome }
            } catch {
              return { key: ref.key, id: ref.id, title: ref.id, directory: undefined, active: null, outcome: undefined }
            }
          }))
          const keys = new Set(sessions.map((session) => session.key))
          for (const key of previous.keys()) if (!keys.has(key)) {
            previous.delete(key); results.delete(key)
            const timeout = delayed.get(key)
            if (timeout) clearTimeout(timeout)
            delayed.delete(key)
          }
          await Promise.all(sessions.map(async (session) => {
            const old = previous.get(session.key)
            const completed = old?.active === true && session.active === false
            const needsLookup = (manual && (!onlyKey || onlyKey === session.key)) || !old || old.directory !== session.directory || completed
            previous.set(session.key, { active: session.active === true, directory: session.directory || "" })
            if (!needsLookup) return
            try {
              let history: any
              try { history = await sessionPullReferences(refs.find((ref) => ref.key === session.key).server.client, session.id) }
              catch { history = { urls: [], directories: [], unavailable: true } }
              const response: any = await backend.read({ directory: session.local ? session.directory || "" : "", directories: session.local ? history.directories : [], urls: history.urls })
              results.set(session.key, { ...response.data, historyTruncated: history.truncated, historyUnavailable: history.unavailable })
              // If a completion coincides with a recent read, do one deferred read
              // after the shared rate limit instead of losing the completion update.
              if (completed && response.cached && !delayed.has(session.key)) {
                const timeout = setTimeout(() => {
                  delayed.delete(session.key)
                  if (!disposed && previous.has(session.key)) void sync(ctx.sessions.list(), true, session.key)
                }, Math.max(0, response.checkedAt + 60100 - Date.now()))
                delayed.set(session.key, timeout)
              }
            }
            catch (error) { results.set(session.key, { note: `Lookup failed: ${error instanceof Error ? error.message : String(error)}` }) }
          }))
          if (disposed) return
          setRows(sessions.map((session) => ({ ...session, result: results.get(session.key) })))
          setMessage(sessions.length ? "" : "No open OpenCode sessions in this window.")
          if (manual && !onlyKey) setLastRefresh(`Refresh requested ${new Date().toLocaleTimeString()}`)
        } finally {
          busy = false
          if (refreshRequested && !disposed) { refreshRequested = false; deferredKeys.clear(); void sync(ctx.sessions.list(), true) }
          else if (deferredKeys.size && !disposed) {
            const key = deferredKeys.values().next().value
            if (key) { deferredKeys.delete(key); void sync(ctx.sessions.list(), true, key) }
          }
        }
      }

      createEffect(() => { void sync(ctx.sessions.list()) })
      // Local session state only; GitHub is read on entry, completion, or manual refresh.
      const timer = setInterval(() => void sync(ctx.sessions.list()), 10000)
      onCleanup(() => { disposed = true; clearInterval(timer); for (const timeout of delayed.values()) clearTimeout(timeout) })

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
          <div title={props.row.title} style={ellipsis}>{props.row.title}</div>
          <small title={props.row.result?.branch || props.row.directory || "Location unavailable"} style={{ ...ellipsis, display: "block", opacity: 0.65 }}>{props.row.result?.branch || props.row.directory || "Location unavailable"}</small>
          <Show when={props.row.result?.historyTruncated || props.row.result?.historyUnavailable}><small style={{ opacity: 0.7 }}>{props.row.result?.historyTruncated ? "History limit reached" : "History unavailable"}</small></Show>
        </td>
      }
      return <div style={{ padding: "16px", overflow: "auto", height: "100%", "font-size": "13px" }}>
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px", "margin-bottom": "8px" }}>
          <div><strong>Orchestrator</strong><div style={{ opacity: 0.7, "font-size": "12px" }}>Open chats in this window</div></div>
          <button type="button" onClick={() => void sync(ctx.sessions.list(), true)} style={{ cursor: "pointer", padding: "4px 8px", border: "1px solid currentColor", "border-radius": "5px" }}>Refresh</button>
        </div>
        <p style={{ opacity: 0.7, "font-size": "12px", "margin-bottom": "12px" }}>Shows the current branch and PRs linked in each chat. GitHub refreshes on completion or manually, at most once per minute. {lastRefresh()}</p>
        <Show when={!message()} fallback={<p>{message()}</p>}>
          <table style={{ width: "100%", "min-width": "850px", "table-layout": "fixed", "border-collapse": "collapse", "text-align": "left" }}>
            <colgroup><col style={{ width: "200px" }} /><col style={{ width: "250px" }} /><col style={{ width: "110px" }} /><col style={{ width: "85px" }} /><col style={{ width: "135px" }} /><col style={{ width: "90px" }} /></colgroup>
            <thead><tr><For each={["Chat / branch", "Pull request", "Status", "CI", "Review", "Comments"]}>{(label) => <th style={{ padding: "7px", "border-bottom": "1px solid", opacity: 0.75, "white-space": "nowrap" }}>{label}</th>}</For></tr></thead>
            <tbody><For each={rows()}>{(row) => <Show when={row.result?.prs?.length} fallback={<tr><SessionCell row={row} span={1} /><td colSpan={5} style={cell}><span style={{ opacity: 0.7 }}>{row.result?.note || "Loading…"}</span></td></tr>}>
              <For each={row.result.prs}>{(pr: any, index) => <tr>
                <Show when={index() === 0}><SessionCell row={row} span={row.result.prs.length} /></Show>
                <td style={{ ...cell, ...ellipsis }}><button type="button" title={`#${pr.number} ${pr.repo}/${pr.branch || "branch unavailable"}`} onClick={() => open(pr.url)} style={{ ...ellipsis, display: "block", width: "100%", cursor: "pointer", "text-align": "left", "text-decoration": "underline" }}>#{pr.number} {pr.repo.split("/").pop()}/{pr.branch || "branch unavailable"}</button></td>
                <For each={[pr.status, pr.ci, pr.review, pr.comments]}>{(value) => <td style={{ ...cell, "white-space": "nowrap" }}><Status value={value} /></td>}</For>
              </tr>}</For>
            </Show>}</For></tbody>
          </table>
        </Show>
      </div>
    }
  },
  main(ctx) {
    const readPR = makePullReader()
    const read = makeReader({ readFn: (info, directory) => readPull(info, directory, (ref, cwd) => readPR(`https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`, cwd)) })
    ctx.provide(Backend, {
      read: async ({ directory, directories, urls }) => {
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
        return { ...branch, data: { branch: branch.data.branch, note: branch.data.note || (directory ? "No PR yet" : "No linked PRs"), prs } }
      },
    })
    ctx.log.write("info", "Orchestrator loaded")
  },
})
