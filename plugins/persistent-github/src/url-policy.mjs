// Restrict the prototype to GitHub, plus one local test server.
export function allowedUrl(value) {
  try {
    const url = new URL(value)
    if (url.username || url.password) return false
    if (url.protocol === 'https:' && (url.hostname === 'github.com' || url.hostname.endsWith('.github.com'))) return !url.port
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '18739'
  } catch {
    return false
  }
}
