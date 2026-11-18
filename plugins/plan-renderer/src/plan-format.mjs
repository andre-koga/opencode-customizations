/** Plan format v1. Keep headings and task field names in sync with PLAN_FORMAT.md. */
export const PLAN_SECTIONS = [
  ['goal', 'Goal'], ['scope', 'Scope'], ['context', 'Context'], ['approach', 'Approach'],
  ['acceptance', 'Acceptance criteria'], ['risks', 'Risks and dependencies'],
  ['verification', 'Verification'], ['history', 'Decisions and history'], ['checklist', 'Checklist'],
].map(([id, title]) => ({ id, title }))
export const TASK_STATUSES = ['todo', 'in-progress', 'blocked', 'done', 'cancelled', 'superseded']
export const TASK_FIELDS = ['Status', 'Depends on', 'PRs', 'Verification', 'Notes']

/** Preserve line numbers; Markdown inside fences/indented code is not plan structure. */
export function structuralLines(markdown) {
  let fence = null
  return markdown.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null
      return ''
    }
    if (marker) { fence = marker[1]; return '' }
    return /^(?: {4}|\t)/.test(line) ? '' : line
  })
}

export function pullRequestUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password) return undefined
    const match = /^\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)(?:\/.*)?$/.exec(url.pathname)
    if (!match) return undefined
    return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`
  } catch { return undefined }
}

function prs(value) {
  if (/^(?:none|not applicable\s*[—–-]\s*\S.+)$/i.test(value)) return { links: [], valid: true }
  const links = [], pattern = /\[([^\]]+)\]\(([^\s)]+)\)|(https:\/\/[^\s,;]+)/g
  const rest = value.replace(pattern, (_, label, href, bare) => {
    const url = pullRequestUrl(href || bare)
    if (!url) return 'INVALID'
    links.push({ url, label: label || `PR #${url.split('/').pop()}` })
    return ''
  })
  return { links, valid: links.length > 0 && /^[\s,;]*$/.test(rest) }
}

/** Parse for display without writing, hiding, or "fixing" source. Invalid plans retain a full-document view. */
export function parsePlan(markdown) {
  const raw = markdown.replace(/^\uFEFF/, '').split(/\r?\n/), lines = structuralLines(markdown)
  const diagnostics = [], metadata = {}, sections = [], tasks = []
  const error = (message, line) => diagnostics.push({ message, ...(line ? { line } : {}) })
  let frontmatterEnd = 0
  if (raw[0] === '---') {
    frontmatterEnd = raw.findIndex((line, index) => index > 0 && line === '---')
    if (frontmatterEnd < 0) { error('Unclosed frontmatter.', 1); frontmatterEnd = 0 }
    else for (let i = 1; i < frontmatterEnd; i++) {
      const match = /^([a-z-]+):\s*(.*?)\s*$/.exec(raw[i])
      if (!match && raw[i].trim()) error('Use simple key: value plan metadata.', i + 1)
      if (match) {
        if (Object.hasOwn(metadata, match[1])) error(`Duplicate metadata: ${match[1]}.`, i + 1)
        metadata[match[1]] = match[2]
      }
    }
  }
  const standard = Object.hasOwn(metadata, 'plan-format')
  if (standard) {
    for (const key of Object.keys(metadata)) if (!['plan-format', 'plan-id', 'revision', 'status', 'implementation', 'updated'].includes(key)) error(`Unknown plan metadata: ${key}.`)
    if (metadata['plan-format'] !== '1') error('Unsupported plan-format; expected 1.', 2)
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata['plan-id'] || '')) error('plan-id must be a stable kebab-case identifier.')
    if (!/^[1-9]\d*$/.test(metadata.revision || '')) error('revision must be a positive integer.')
    if (!['draft', 'approved', 'in-progress', 'blocked', 'completed'].includes(metadata.status)) error('Invalid plan status.')
    if (!['not-authorized', 'authorized'].includes(metadata.implementation)) error('implementation must be not-authorized or authorized.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.updated || '') || !Number.isFinite(Date.parse(metadata.updated)) || new Date(metadata.updated).toISOString().slice(0, 10) !== metadata.updated) error('updated must be a valid YYYY-MM-DD date.')
  }
  const titles = []
  for (let i = frontmatterEnd + (frontmatterEnd ? 1 : 0); i < lines.length; i++) {
    const title = /^ {0,3}#\s+(.+?)\s*#*\s*$/.exec(lines[i])
    if (title) titles.push({ title: title[1], line: i + 1 })
    const heading = /^ {0,3}##\s+(.+?)\s*#*\s*$/.exec(lines[i])
    if (heading) {
      const known = PLAN_SECTIONS.find((section) => section.title === heading[1])
      const id = known && !sections.some((section) => section.id === known.id) ? known.id : `section-${i + 1}`
      sections.push({ id, title: heading[1], line: i + 1, start: i, end: lines.length })
    }
  }
  sections.forEach((section, index) => {
    section.end = sections[index + 1]?.start ?? lines.length
    section.markdown = raw.slice(section.start, section.end).join('\n')
  })
  if (standard) {
    if (titles.length !== 1) error('Use exactly one # plan title.')
    if (titles[0] && raw.slice(frontmatterEnd + 1, titles[0].line - 1).some((line) => line.trim())) error('Only metadata and whitespace may precede the plan title.')
    if (sections.map((section) => section.title).join('|') !== PLAN_SECTIONS.map((section) => section.title).join('|')) error('Use all nine required sections in the documented order; Checklist must be last.')
    if (sections[0] && titles[0] && titles[0].line >= sections[0].line) error('The plan title must precede Goal.')
    if (titles[0] && sections[0] && raw.slice(titles[0].line, sections[0].start).some((line) => line.trim())) error('Place introductory content inside Goal, not before the sections.')
    for (const section of sections) if (!raw.slice(section.start + 1, section.end).some((line) => line.trim())) error(`${section.title} must contain content (use None with an explanation when appropriate).`, section.line)
  }
  const checklist = sections.find((section) => section.title === 'Checklist')
  let group = 'Tasks'
  for (let i = 0; i < lines.length; i++) {
    const inChecklist = checklist && i > checklist.start && i < checklist.end
    const heading = /^###\s+(.+?)\s*#*\s*$/.exec(lines[i])
    if (inChecklist && heading) group = heading[1]
    const checkbox = /^(\s*)(?:[-+*]|\d+[.)])\s+\[([ xX])\]\s*(.*)$/.exec(lines[i])
    if (!checkbox) continue
    if (standard && !inChecklist) { error('Task checkboxes belong only in Checklist.', i + 1); continue }
    const label = checkbox[3].replace(/^\*\*(.*?)\*\*$/, '$1')
    const match = /^(T\d{3,})\s+—\s+(\S.*)$/.exec(label)
    let end = i + 1
    while (end < raw.length && !/^(?: {0,3}#{1,3}\s|\s*(?:[-+*]|\d+[.)])\s+\[[ xX]\])/.test(lines[end])) end++
    const fields = {}
    let lastField
    for (let j = i + 1; j < end; j++) {
      const field = /^  - ([^:]+):\s*(.*)$/.exec(lines[j])
      if (!field) {
        if (lastField === 'Notes' && /^ {4}\S|^ {4} +\S/.test(raw[j])) fields.Notes += `\n${raw[j].slice(4)}`
        continue
      }
      if (standard && (!TASK_FIELDS.includes(field[1]) || Object.hasOwn(fields, field[1]))) error(`Unknown or duplicate task field: ${field[1]}.`, j + 1)
      fields[field[1]] = field[2].trim()
      lastField = field[1]
    }
    const checked = checkbox[2].toLowerCase() === 'x'
    const links = prs(fields.PRs || 'none')
    const task = {
      id: match?.[1] || `line-${i + 1}`, title: match?.[2] || label, line: i + 1, endLine: end,
      checked, status: fields.Status || (checked ? 'done' : 'todo'), group,
      fields, prs: links.links, markdown: raw.slice(i, end).join('\n'),
    }
    tasks.push(task)
    if (standard) {
      if (!match || checkbox[1] || !lines[i].startsWith('- ')) error('Use - [ ] **T001 — Task title** (stable ID, em dash, top-level dash list).', i + 1)
      for (const key of TASK_FIELDS) if (!fields[key]) error(`${task.id}: missing ${key}.`, i + 1)
      if (Object.keys(fields).join('|') !== TASK_FIELDS.join('|')) error(`${task.id}: use the five task fields in the documented order.`, i + 1)
      if (!TASK_STATUSES.includes(task.status)) error(`${task.id}: invalid Status.`, i + 1)
      if (checked !== (task.status === 'done')) error(`${task.id}: [x] is reserved for Status: done.`, i + 1)
      if (!links.valid) error(`${task.id}: PRs must contain GitHub pull request links, none, or not applicable — reason.`, i + 1)
      if (task.status === 'done' && /^(?:none|pending|not run|todo)\b/i.test(fields.Verification || 'none')) error(`${task.id}: done requires verification evidence.`, i + 1)
      if (task.status === 'done' && !links.links.length && !/^not applicable\s*[—–-]\s*\S.+$/i.test(fields.PRs || '')) error(`${task.id}: done requires a PR link or an explicit not-applicable reason.`, i + 1)
      if (['blocked', 'cancelled', 'superseded'].includes(task.status) && /^(?:none|pending)$/i.test(fields.Notes || 'none')) error(`${task.id}: ${task.status} requires a reason in Notes.`, i + 1)
      if (fields['Depends on'] && fields['Depends on'] !== 'none' && !/^T\d{3,}(?:,\s*T\d{3,})*$/.test(fields['Depends on'])) error(`${task.id}: Depends on must be none or comma-separated task IDs.`, i + 1)
    }
  }
  if (standard) {
    const ids = new Set()
    for (const task of tasks) {
      if (ids.has(task.id)) error(`Duplicate task ID: ${task.id}.`, task.line)
      ids.add(task.id)
    }
    for (const task of tasks) for (const id of (task.fields['Depends on'] || '').split(/,\s*/)) {
      if (id && id !== 'none' && (!ids.has(id) || id === task.id)) error(`${task.id}: invalid dependency ${id}.`, task.line)
    }
    for (const task of tasks) if (task.status === 'superseded') {
      const replacements = (task.fields.Notes || '').match(/\bT\d{3,}\b/g) || []
      if (!replacements.length || replacements.some((id) => !ids.has(id) || id === task.id)) error(`${task.id}: superseded Notes must name existing replacement task IDs.`, task.line)
    }
    // Cycles make the ordered checklist impossible to complete.
    const active = new Set(), visited = new Set(), byId = new Map(tasks.map((task) => [task.id, task]))
    const visit = (id) => {
      if (active.has(id)) { error(`Dependency cycle involving ${id}.`); return }
      if (visited.has(id)) return
      active.add(id)
      for (const dependency of (byId.get(id)?.fields['Depends on'] || '').split(/,\s*/)) if (byId.has(dependency)) visit(dependency)
      active.delete(id); visited.add(id)
    }
    tasks.forEach((task) => visit(task.id))
    if (!tasks.length) error('Checklist must contain at least one task.')
    if (metadata.status === 'completed' && tasks.some((task) => !['done', 'cancelled', 'superseded'].includes(task.status))) error('A completed plan cannot contain unfinished tasks.')
  }
  return { standard, metadata, title: titles[0]?.title || 'Plan', sections, tasks, diagnostics, valid: standard && !diagnostics.length }
}

export function planProgress(plan) {
  const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0]))
  for (const task of plan.tasks) if (Object.hasOwn(counts, task.status)) counts[task.status]++
  return { counts, done: counts.done, total: plan.tasks.length - counts.cancelled - counts.superseded, retired: counts.cancelled + counts.superseded }
}
