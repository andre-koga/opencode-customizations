/** Prefer the native PR viewer; fall back to the app browser and then the system browser. */
export function openPullRequest({ session, url, native, browser, external }) {
  if (session && native.status === 'active' && native.value.open(session, url)) return 'native'
  if (session && browser.status === 'active' && browser.value.canOpen(session, url)) {
    browser.value.open(session, url)
    return 'browser'
  }
  external(url)
  return 'external'
}
