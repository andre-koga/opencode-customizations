const { Contract, LinkHandler, Plugin } = require("@opencode/plugin/gui")
const { Browser } = require("@opencode/plugin/gui/browser")
const NativePR = Contract.define("native-pr.open")

function isPullRequest(href) {
  try {
    const url = new URL(href)
    return url.protocol === "https:" && url.hostname === "github.com" &&
      /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(url.pathname)
  } catch {
    return false
  }
}

exports.default = Plugin.define({
  setup(ctx) {
    const browser = ctx.use(Browser)
    const nativePR = ctx.use(NativePR)

    function openNative(session, href) {
      const live = nativePR()
      return !!session && live.status === "active" && live.value.open(session, href)
    }

    ctx.add(LinkHandler, {
      priority: 1000,
      match(link) {
        if (!isPullRequest(link.href)) return false
        const session = link.session || ctx.sessions.current()
        const live = browser()
        return !!session && (nativePR().status === "active" || (live.status === "active" && live.value.canOpen(session, link.href)))
      },
      exists: () => true,
      open(link) {
        const session = link.session || ctx.sessions.current()
        if (openNative(session, link.href)) return
        const live = browser()
        if (session && live.status === "active" && live.value.canOpen(session, link.href)) {
          live.value.open(session, link.href)
        } else {
          ctx.system.openExternal(link.href)
        }
      },
    })

    // Message Markdown sends ordinary web links directly to the external browser
    // instead of through LinkHandler. Intercept only unmodified PR-link clicks.
    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null
      if (!anchor || !isPullRequest(anchor.href)) return
      const session = ctx.sessions.current()
      if (openNative(session, anchor.href)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const live = browser()
      if (!session || live.status !== "active" || !live.value.canOpen(session, anchor.href)) return
      event.preventDefault()
      event.stopPropagation()
      live.value.open(session, anchor.href)
    }

    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  },
  main(ctx) {
    ctx.log.write("info", "GitHub PR link plugin loaded")
  },
})
