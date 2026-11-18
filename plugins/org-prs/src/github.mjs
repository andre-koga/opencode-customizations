import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const githubName = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i

export async function ghApi(path) {
  const { stdout } = await exec('gh', ['api', '--hostname', 'github.com', path], { timeout: 20000, maxBuffer: 12 * 1024 * 1024 })
  return JSON.parse(stdout)
}

/** Only display canonical PR links from the requested organization. */
export function normalizePull(item, organization) {
  try {
    const url = new URL(item.html_url)
    const match = /^\/([a-z0-9-]+)\/([a-z0-9_.-]+)\/pull\/([1-9][0-9]*)$/i.exec(url.pathname)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || !match || match[1].toLowerCase() !== organization.toLowerCase() || Number(match[3]) !== item.number || !Number.isSafeInteger(item.number)) return null
    return {
      key: `${match[1].toLowerCase()}/${match[2].toLowerCase()}#${item.number}`,
      url: `https://github.com/${match[1]}/${match[2]}/pull/${item.number}`,
      repo: match[2], number: item.number, title: typeof item.title === 'string' ? item.title : '',
      status: item.pull_request?.merged_at ? 'Merged' : item.state === 'closed' ? 'Closed' : item.draft ? 'Draft' : 'Open',
      updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
      comments: Number.isSafeInteger(item.comments) && item.comments >= 0 ? item.comments : null,
    }
  } catch { return null }
}

/** Share in-flight reads; do not poll. GitHub Search can return at most 1,000 results. */
export function makeReader({ api = ghApi, now = Date.now, ttl = 60_000 } = {}) {
  const cache = new Map()
  return async ({ organization, scope }) => {
    if (!githubName.test(organization || '') || !['open', 'all'].includes(scope)) throw new Error('Invalid organization or filter.')
    const key = `${organization.toLowerCase()}:${scope}`
    const old = cache.get(key)
    if (old && now() - old.time < ttl) return { data: await old.promise, cached: true, checkedAt: old.time }
    const entry = { time: now(), promise: null }
    entry.promise = (async () => {
      const user = await api('user')
      if (!githubName.test(user?.login || '')) throw new Error('GitHub authentication did not return a valid account.')
      const query = [`org:${organization}`, `author:${user.login}`, 'is:pr', ...(scope === 'open' ? ['is:open'] : [])].join(' ')
      const pulls = new Map()
      let total = 0, incomplete = false, limited = false
      for (let page = 1; page <= 10; page++) {
        const params = new URLSearchParams({ q: query, sort: 'updated', order: 'desc', per_page: '100', page: String(page) })
        const result = await api(`search/issues?${params}`)
        if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total_count) || result.total_count < 0) throw new Error('GitHub returned an invalid search response.')
        if (page === 1) total = result.total_count
        incomplete ||= result.incomplete_results === true
        for (const item of result.items) {
          const pr = normalizePull(item, organization)
          if (pr && !pulls.has(pr.key)) pulls.set(pr.key, pr)
        }
        if (result.items.length < 100 || page * 100 >= total) break
        if (page === 10) limited = true
      }
      return { login: user.login, organization, scope, pulls: [...pulls.values()], total, incomplete, limited: limited || total > 1000 }
    })().catch((error) => { if (cache.get(key) === entry) cache.delete(key); throw error })
    cache.set(key, entry)
    return { data: await entry.promise, cached: false, checkedAt: entry.time }
  }
}
