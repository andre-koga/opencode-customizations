import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { parsePlan } from './plan-format.mjs'

const paths = process.argv.slice(2)
if (!paths.length) { console.error('Usage: node validate.mjs <plan.md> [...]'); process.exitCode = 1 }
for (const path of paths) {
  try {
    const plan = parsePlan(await readFile(path, 'utf8'))
    const errors = [...plan.diagnostics]
    if (!plan.standard) errors.push({ message: 'Missing plan-format: 1; normalize with PLAN_FORMAT.md, preserving history.' })
    if (plan.standard && basename(path) !== `${plan.metadata['plan-id']}.md` && !/^r\d{3,}\.md$/.test(basename(path))) errors.push({ message: 'Active filename must match plan-id.' })
    if (errors.length) {
      process.exitCode = 1
      for (const error of errors) console.error(`${path}${error.line ? `:${error.line}` : ''}: ${error.message}`)
    } else console.log(`${path}: valid v1, revision ${plan.metadata.revision}, ${plan.tasks.length} tasks`)
  } catch (error) { process.exitCode = 1; console.error(`${path}: ${error.message}`) }
}
