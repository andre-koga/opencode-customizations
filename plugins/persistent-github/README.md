# Persistent GitHub browser prototype

Adds a separate **Persistent GitHub** panel to OpenCode Desktop. Open it from the
side panel's **+** menu or the command palette. It uses its own Electron profile
(`persist:persistent-github`), shared between instances of this panel. Sign in
inside the panel; it does not import another browser's credentials.

This prototype is intentionally separate from OpenCode's built-in browser and
does not intercept PR links. It only navigates to HTTPS `github.com` and its
subdomains; a local HTTP server at `127.0.0.1:18739` is allowed for testing.
Popups and permission requests are denied. The agent's built-in browser tools
cannot control this custom panel. Authentication, cookie persistence after an
app restart, and real GitHub functionality need manual verification.

To disable it, remove `./plugins/persistent-github` from the global OpenCode
configuration or use Settings > Extensions > Plugins. Disabling the plugin does
not erase the persistent profile or sign out of GitHub.
