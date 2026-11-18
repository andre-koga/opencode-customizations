// Extract only canonical GitHub pull-request links, not issue or lookalike URLs.
export function pullReferences(messages, limit = 100) {
  const found = new Map()
  const collect = (text) => {
    if (typeof text !== "string") return
    for (const match of text.matchAll(/https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)(?![A-Za-z0-9])/g)) {
      const number = Number(match[3])
      if (!Number.isSafeInteger(number)) continue
      const key = `${match[1].toLowerCase()}/${match[2].toLowerCase()}#${number}`
      if (!found.has(key)) found.set(key, `https://github.com/${match[1]}/${match[2]}/pull/${number}`)
    }
  }
  for (const message of messages) {
    if (message.type === "user") collect(message.text)
    if (message.type !== "assistant") continue
    for (const part of message.content || []) {
      if (part.type === "text") collect(part.text)
      // Tool results can contain whole search results. Only use output of a
      // successful PR creation, rather than attributing every listed PR.
      if (part.type === "tool" && part.state?.status === "completed" && /\bgh\s+pr\s+create\b/.test(part.state.input?.command || "")) {
        for (const item of part.state.content || []) if (item.type === "text") collect(item.text)
      }
    }
  }
  const urls = [...found.values()]
  return { urls: urls.slice(0, limit), truncated: urls.length > limit }
}

export async function sessionPullReferences(client, sessionID, { maxPages = 10, pageSize = 100 } = {}) {
  const messages = []
  let cursor
  let truncated = false
  let incomplete = false
  for (let page = 0; page < maxPages; page++) {
    // A cursor already encodes ordering; the API rejects `order` alongside it.
    let result
    try {
      result = await client.message.list({ sessionID, limit: pageSize, ...(cursor ? { cursor } : { order: "desc" }) })
    } catch (error) {
      if (page === 0) throw error
      incomplete = true
      break
    }
    messages.push(...result.data)
    const next = result.cursor?.next
    if (!next || next === cursor) break
    cursor = next
    if (page === maxPages - 1) truncated = true
  }
  const refs = pullReferences(messages)
  const locations = new Set()
  for (const message of messages) {
    if (message.type !== "location-switched") continue
    for (const directory of [message.location?.directory, message.previous?.location?.directory]) {
      if (typeof directory === "string" && directory) locations.add(directory)
    }
  }
  const directories = [...locations]
  return { urls: refs.urls, directories: directories.slice(0, 20), truncated: truncated || refs.truncated || directories.length > 20, incomplete }
}
