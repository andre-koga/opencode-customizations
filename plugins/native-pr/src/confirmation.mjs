/** Ready is a direct action; merges always require explicit confirmation. */
export async function confirmPrimaryAction(state, current, confirm) {
  if (state === 'draft') return true
  if (state !== 'ready') return false
  return confirm({
    title: 'Merge this pull request?',
    description: `Merge ${current.ref.owner}/${current.ref.repo} #${current.ref.number} into ${current.pull.base} with a merge commit. GitHub will enforce its rules. The PR status and head commit will be checked again.`,
    confirm: 'Merge pull request',
    danger: true,
  })
}
