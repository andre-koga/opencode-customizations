export const palette = {
  dark: { success: '#78dba1', completed: '#c5a5f5', warning: '#e8bd70', critical: '#ff9696', info: '#9abfff', weak: '#b0b8c4' },
  light: { success: '#176b3a', completed: '#7040ad', warning: '#805700', critical: '#b42332', info: '#245da8', weak: '#586474' },
}

/** Presentation only. Never use a visual status to decide permission or mergeability. */
export function statusTone(value) {
  const status = String(value ?? '').trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-')
  if (['merged', 'done', 'completed'].includes(status)) return 'completed'
  if (['passed', 'success', 'approved', 'ready', 'open'].includes(status)) return 'success'
  if (['failed', 'failure', 'error', 'blocked', 'conflict', 'conflicts', 'not-ready', 'changes-requested', 'timed-out', 'startup-failure', 'action-required', 'stale'].includes(status)) return 'critical'
  if (['running', 'in-progress', 'pending', 'queued', 'waiting', 'requested', 'expected', 'outdated'].includes(status)) return 'warning'
  if (['info'].includes(status)) return 'info'
  return 'weak'
}

export function statusLabel(value) {
  const labels = { todo: 'To do', done: 'Completed', running: 'In progress', 'in-progress': 'In progress', 'not-started': 'Not started', 'changes-requested': 'Changes requested', 'not-ready': 'Not ready', 'timed-out': 'Timed out', 'action-required': 'Action required', 'startup-failure': 'Startup failed' }
  const raw = String(value ?? '').trim().replaceAll('_', '-')
  const text = raw === raw.toUpperCase() ? raw.toLowerCase() : raw
  if (!text || text === '—' || text === '?') return 'Unknown'
  return labels[text.toLowerCase()] || text.charAt(0).toUpperCase() + text.slice(1)
}

export function statusColor(value, mode) {
  const tone = statusTone(value)
  return mode ? (palette[mode] || palette.dark)[tone] : `var(--oc-${tone}, ${palette.dark[tone]})`
}

export function findingsStatus(findings) {
  if (!findings) return { tone: 'weak', label: 'Not reviewed' }
  if (findings.outdated) return { tone: 'warning', label: `${findings.count} · Outdated` }
  if (!/^\d+$/.test(String(findings.count))) return { tone: 'weak', label: 'Unknown' }
  return { tone: Number(findings.count) ? 'critical' : 'success', label: String(findings.count) }
}
