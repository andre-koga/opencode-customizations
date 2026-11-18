/** Resolve the current tab at click time, so closed or moved chats are not misdirected. */
export function focusSession(sessions, tabs, key) {
  const session = sessions.list().find((item) => item.key === key)
  if (!session) return false
  tabs.focus(session.tab)
  return true
}
