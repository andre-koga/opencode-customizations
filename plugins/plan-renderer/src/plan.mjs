/** Restrict the renderer to the explicit plan location used by the planner. */
export function isPlanPath(path) {
  return typeof path === 'string' && /^\.opencode\/plans\/[^/\\]+\.md$/i.test(path) && !path.includes('\0')
}

/** Count Markdown task-list items, excluding fenced code examples. */
export function taskProgress(markdown) {
  let fence = null, done = 0, total = 0
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*(?:`+|~+)\s*$/.test(line)) fence = null
      continue
    }
    if (fence) continue
    const task = /^\s*(?:[-+*]|\d+[.)])\s+\[([ xX])\](?:\s|$)/.exec(line)
    if (task) { total++; if (task[1].toLowerCase() === 'x') done++ }
  }
  return { done, total }
}

/** Switch first; never send to a different agent if the switch fails. */
export async function buildPlan(session, root, path) {
  if (!isPlanPath(path) || typeof root !== 'string' || !root) throw new Error('Select a plan in .opencode/plans first.')
  const absolute = `${root.replace(/[\\/]+$/, '')}/${path}`
  await session.server.client.session.switchAgent({ sessionID: session.id, agent: 'build' })
  await session.server.client.session.prompt({
    sessionID: session.id,
    delivery: 'queue',
    text: `Build according to the selected plan at ${JSON.stringify(absolute)}. Read it first, work through the remaining tasks, and keep its checklist current. Follow all applicable AGENTS.md instructions and required approvals. Before editing, ensure the selected plan is available in the required task worktree; if it is not, ask how to bring it across.`,
  })
}
