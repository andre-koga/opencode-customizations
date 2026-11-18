import { parsePullUrl } from './github.mjs'

/** Keep the new-thread instruction identical to the current-thread request. */
export function primaryActionPrompt(action, url) {
  const ref = parsePullUrl(url)
  if (!ref) throw new Error('The selected pull request is invalid.')
  if (!['conflict', 'blocked'].includes(action?.kind)) throw new Error('This action cannot be requested in a new thread.')
  const task = action.kind === 'conflict'
    ? 'Investigate and resolve the merge conflicts for'
    : action.task || 'Investigate and address merge blockers for'
  return `${task} ${ref.url}. Verify the current PR status, follow repository and worktree instructions, and do not merge the PR.`
}

/** Open a new, unsent draft in the same server and worktree as the current thread. */
export function openActionDraft(layout, session, prompt) {
  if (!session?.server?.id || !session.directory || typeof layout?.draft !== 'function') {
    throw new Error('No active OpenCode thread is available for a new draft.')
  }
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('The thread instruction is empty.')
  layout.draft({ server: session.server.id, directory: session.directory, prompt })
}
