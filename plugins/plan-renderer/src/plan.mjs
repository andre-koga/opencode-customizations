import { parsePlan, pullRequestUrl } from './plan-format.mjs'

/** Restrict the renderer to active plans, never archived revision snapshots. */
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
export async function buildPlan(session, root, path, markdown) {
  if (!isPlanPath(path) || typeof root !== 'string' || !root) throw new Error('Select a plan in .opencode/plans first.')
  const plan = parsePlan(typeof markdown === 'string' ? markdown : '')
  if (!plan.valid || path !== `.opencode/plans/${plan.metadata['plan-id']}.md`) throw new Error('Normalize and validate this plan with PLAN_FORMAT.md before building.')
  if (!session?.server?.client?.session) throw new Error('No active OpenCode thread is available.')
  const absolute = `${root.replace(/[\\/]+$/, '')}/${path}`
  await session.server.client.session.switchAgent({ sessionID: session.id, agent: 'build' })
  await session.server.client.session.prompt({
    sessionID: session.id,
    delivery: 'queue',
    text: `Build according to the selected plan at ${JSON.stringify(absolute)} (plan ${plan.metadata['plan-id']}, revision ${plan.metadata.revision}). Read the current file first; if its material revision differs from the displayed revision, ask the user to reconfirm before implementation. Read ~/.config/opencode/plugins/plan-renderer/PLAN_FORMAT.md and maintain its v1 layout: Goal first, Checklist last, stable task IDs, explicit statuses, verification evidence, and real PR links for completed implementation tasks (an explicit not-applicable reason for genuinely local-only work). This user Build request authorizes implementation, but does not bypass unresolved scope decisions, repository permissions, worktree rules, or required approvals. Update the plan's implementation authorization accordingly. Before material scope/design changes, snapshot the prior revision under .opencode/plans/history/<plan-id>/rNNN.md without overwriting; increment revision, preserve old decisions and task progress, retain cancelled/superseded tasks, and append a dated history entry. Progress-only changes do not require a new material revision. Work through remaining authorized tasks and validate the plan after edits. Before editing, ensure the selected plan is available in the required task worktree; if it is not, ask how to bring it across.`,
  })
}

/** Question actions are drafts, not agent requests. Never replace existing composer text. */
export function stagePlanQuestion(composer, { root, path, plan, task, section, question }) {
  if (!composer?.quotable() || !isPlanPath(path) || !root) throw new Error('Open the plan in the active chat before asking a question.')
  const absolute = `${root.replace(/[\\/]+$/, '')}/${path}`
  const label = task ? `${task.id} — ${task.title}` : section?.title || 'Plan format'
  const subject = `${absolute}; plan ${plan.metadata['plan-id'] || 'legacy'}, revision ${plan.metadata.revision || 'unknown'}; ${task ? `task ${task.id}, status ${task.status}, line ${task.line}` : label}`
  composer.attach({
    type: 'quote', commentID: globalThis.crypto.randomUUID(),
    text: task?.markdown || section?.markdown || 'Normalize this plan to Plan Format v1 without losing prior ideas, progress, or evidence.',
    source: { label, icon: 'file-tree', subject },
    comment: `${question}\nRead the current plan first; the quoted content may be stale. Discuss before changing scope or executing work.`,
  })
  if (!composer.text().trim()) composer.insert(task ? `Question about ${task.id} in the selected plan.` : `Question about ${label} in the selected plan.`)
  composer.focus()
}

/** Use the existing native PR panel; external navigation is only a fallback. */
export function openTaskPullRequest(nativePR, session, href, openExternal) {
  const url = pullRequestUrl(href)
  if (!url || !session) throw new Error('Choose a valid GitHub pull request in the active chat.')
  const live = nativePR()
  if (live.status === 'active' && live.value.open(session, url)) return 'native'
  openExternal(url)
  return 'external'
}
