import { Schema } from 'effect'
import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { Command, Ipc, MenuItem, Panel, Plugin, Style } from '@opencode/plugin/gui'
import { WebContentsView, session } from 'electron'
import { allowedUrl } from './url-policy.mjs'
import theme from '../../shared-ui/theme.css?inline'

const Backend = Ipc.define({
  id: 'persistent-github.browser',
  methods: {
    create: { input: Schema.String, output: Schema.String },
    navigate: { input: Schema.Struct({ key: Schema.String, url: Schema.String }) },
    back: { input: Schema.String },
    forward: { input: Schema.String },
    reload: { input: Schema.String },
    close: { input: Schema.String },
  },
  events: {
    navigated: Schema.Struct({ key: Schema.String, url: Schema.String }),
  },
})

export default Plugin.define({
  setup(ctx) {
    ctx.add(Style, theme)
    const backend = ctx.main(Backend)
    const tab = { id: 'main', title: 'Persistent GitHub', closable: 'compact' as const }
    const open = () => {
      const current = ctx.sessions.current()
      if (current) ctx.layout.open(`${ctx.id}:main`, current)
    }
    ctx.add(Command, () => ({ id: 'open', title: 'Open persistent GitHub browser', run: open }))
    ctx.add(MenuItem, () => ({ menu: 'session.panel' as const, id: 'open', title: 'Persistent GitHub', icon: 'github' as const, run: open }))
    ctx.add(Panel, {
      id: 'main',
      region: 'side',
      wide: true,
      list: ({ open }) => open.includes('main') ? [tab] : [],
      render: () => <BrowserPanel />,
    })

    function BrowserPanel() {
      const key = crypto.randomUUID()
      const [embed, setEmbed] = createSignal<string>()
      const [url, setUrl] = createSignal('https://github.com/')
      const [message, setMessage] = createSignal('')
      const [loading, setLoading] = createSignal(true)
      let disposed = false
      const unsubscribe = backend.on('navigated', (event) => {
        if (event.key === key) setUrl(event.url)
      })
      const run = (action: Promise<unknown>) => void action.catch((error) => {
        if (!disposed) setMessage(error instanceof Error ? error.message : String(error))
      })
      onMount(() => {
        console.info('[persistent-github] mounting panel')
        void backend.create(key).then((id) => {
          if (disposed) return backend.close(key)
          console.info('[persistent-github] browser view ready')
          setEmbed(id)
          setLoading(false)
        }).catch((error) => { if (!disposed) { setLoading(false); setMessage(String(error)) } })
      })
      onCleanup(() => {
        disposed = true
        unsubscribe()
        void backend.close(key).catch(() => {})
      })

      return <div class="oc-panel" data-theme={ctx.appearance.mode()} style={{ display: 'flex', 'flex-direction': 'column', gap: '10px', padding: '12px' }}>
        <div style={{ display: 'flex', gap: '5px', 'align-items': 'center' }}>
          <button type="button" class="oc-button" aria-label="Back" onClick={() => run(backend.back(key))}>←</button>
          <button type="button" class="oc-button" aria-label="Forward" onClick={() => run(backend.forward(key))}>→</button>
          <button type="button" class="oc-button" aria-label="Refresh" onClick={() => run(backend.reload(key))}>↻</button>
          <form style={{ display: 'flex', flex: 1, gap: '4px', 'min-width': 0 }} onSubmit={(event) => {
            event.preventDefault()
            setMessage('')
            run(backend.navigate({ key, url: url() }))
          }}>
            <input class="oc-input" aria-label="GitHub URL" value={url()} onInput={(event) => setUrl(event.currentTarget.value)} style={{ flex: 1, 'min-width': 0 }} />
            <button type="submit" class="oc-button">Go</button>
          </form>
        </div>
        <Show when={message()}><div role="alert" class="oc-alert" data-tone="critical">{message()}</div></Show>
        <Show when={loading()}><div>Loading browser…</div></Show>
        <div style={{ flex: 1, 'min-height': 0 }}><ctx.embeds.View id={embed()} visible radius={4} class="h-full w-full" /></div>
      </div>
    }
  },
  main(ctx) {
    ctx.log.write('info', 'Persistent GitHub prototype started')
    const profile = session.fromPartition('persist:persistent-github')
    profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    profile.setPermissionCheckHandler(() => false)
    const views = new Map<string, { view: WebContentsView; embed: ReturnType<typeof ctx.embeds.create>; window: number }>()
    const id = (window: number, key: string) => `${window}:${key}`
    const find = (window: number, key: string) => {
      const found = views.get(id(window, key))
      if (!found || found.view.webContents.isDestroyed()) throw new Error('Browser is not open')
      return found
    }
    const release = (window: number, key: string) => {
      const entry = views.get(id(window, key))
      if (!entry) return
      views.delete(id(window, key))
      entry.embed.dispose()
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    }
    const provider = ctx.provide(Backend, {
      create(key, caller) {
        ctx.log.write('info', 'Persistent GitHub creating browser view', { window: caller.window })
        if (!/^[a-f0-9-]{36}$/i.test(key)) throw new Error('Invalid browser identifier')
        const window = ctx.windows.get(caller.window)
        if (!window || window.isDestroyed()) throw new Error('Window is unavailable')
        release(caller.window, key)
        const view = new WebContentsView({ webPreferences: { partition: 'persist:persistent-github', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, devTools: false } })
        const embed = ctx.embeds.create(view, window)
        views.set(id(caller.window, key), { view, embed, window: caller.window })
        view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        const guard = (event: Electron.Event, details: string | { url: string }) => {
          const target = typeof details === 'string' ? details : details.url
          if (!allowedUrl(target)) event.preventDefault()
        }
        view.webContents.on('will-navigate', guard)
        view.webContents.on('will-redirect', guard)
        view.webContents.on('did-navigate', () => provider.emit('navigated', { key, url: view.webContents.getURL() }, caller.window))
        view.webContents.on('did-navigate-in-page', () => provider.emit('navigated', { key, url: view.webContents.getURL() }, caller.window))
        embed.show(true)
        void view.webContents.loadURL('https://github.com/').then(() => {
          ctx.log.write('info', 'Persistent GitHub page loaded')
        }).catch((error) => {
          ctx.log.write('error', 'Persistent GitHub page failed to load', { error: String(error) })
        })
        return embed.id
      },
      async navigate({ key, url }, caller) {
        if (!allowedUrl(url)) throw new Error('Only HTTPS GitHub URLs are supported in this prototype')
        await find(caller.window, key).view.webContents.loadURL(url)
      },
      back(key, caller) { const history = find(caller.window, key).view.webContents.navigationHistory; if (history.canGoBack()) history.goBack() },
      forward(key, caller) { const history = find(caller.window, key).view.webContents.navigationHistory; if (history.canGoForward()) history.goForward() },
      reload(key, caller) { find(caller.window, key).view.webContents.reload() },
      close(key, caller) { release(caller.window, key) },
    })
    const off = ctx.windows.on('close', (window) => {
      for (const [key, entry] of views) if (entry.window === window.id) {
        entry.embed.dispose()
        if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
        views.delete(key)
      }
    })
    return () => {
      off()
      for (const entry of views.values()) {
        entry.embed.dispose()
        if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
      }
      views.clear()
    }
  },
})
