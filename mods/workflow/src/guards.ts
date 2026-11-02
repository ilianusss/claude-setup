import type { EngineInterface, On } from 'claude-code'

import { afterShell } from './build'
import { DEFAULT_SPECS_DIR, loadContext } from './context'
import { matchesAny } from './glob'
import { readPhase, writeScope } from './phases'
import { describe } from './refusal'
import { relativeTo } from './repo'
import { refreshStatus } from './status'
import { readLock } from './store'

async function writeRefusal($: EngineInterface, path: string): Promise<string | undefined> {
  const context = await loadContext($)
  if (context === undefined) return undefined
  if (relativeTo(context.paths.dir, path) !== undefined) {
    return `workflow: only the workflow mod writes ${context.paths.dir}. Update the handoff with mcp__workflow__handoff; phases move with mcp__workflow__advance.`
  }
  const workflow = context.current
  const file = relativeTo(context.repo.root, path)
  if (workflow === undefined || file === undefined) return undefined

  let lock
  try {
    lock = await readLock($, context.paths, workflow.slug)
  } catch (error) {
    return `workflow: ${describe(error)}`
  }
  if (lock?.phase === 'green' && lock.files[file] !== undefined && !lock.unlocked.includes(file)) {
    return `workflow: ${file} is a locked test of slice ${lock.slice}: it stays as written until mcp__workflow__verify passes. If the test is wrong, stop, explain why with evidence, and call mcp__workflow__unlock with the reason: the user decides.`
  }

  if (workflow.status !== 'active') return undefined
  let scope: string[]
  try {
    scope = writeScope(await readPhase($, workflow.phase), workflow, context.config?.specsDir ?? DEFAULT_SPECS_DIR)
  } catch {
    return undefined
  }
  if (scope.length > 0 && !matchesAny(file, scope)) {
    return `workflow: the ${workflow.phase} phase of "${workflow.slug}" may only write ${scope.join(', ')}. Code starts in the build phase; if this change is needed now, ask the user.`
  }
  return undefined
}

function failed(what: string): { deny: string } {
  return { deny: `workflow: the guard on ${what} failed, so the call is refused.` }
}

export function registerGuards(on: On): void {
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const reason = await writeRefusal($, e.file_path)
    return reason === undefined ? next(e) : { deny: reason }
  }).catch(($, e, next) => (next.called ? next(e) : failed('an Edit')))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const reason = await writeRefusal($, e.file_path)
    return reason === undefined ? next(e) : { deny: reason }
  }).catch(($, e, next) => (next.called ? next(e) : failed('a Write')))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const reason = await writeRefusal($, e.notebook_path)
    return reason === undefined ? next(e) : { deny: reason }
  }).catch(($, e, next) => (next.called ? next(e) : failed('a notebook edit')))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const context = await loadContext($)
    if (context?.current === undefined) return ran
    const notes = await afterShell($, context, e.command, ran, await $.clock.now())
    if (notes.length === 0) return ran
    await refreshStatus($, context)
    return { ...ran, context: [...(ran.context ?? []), ...notes] }
  })
}
