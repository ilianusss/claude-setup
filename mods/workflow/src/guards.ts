import type { EngineInterface, On } from 'claude-code'

import { afterShell } from './build'
import { DEFAULT_SPECS_DIR, loadContext } from './context'
import { matchesAny } from './glob'
import { readPhase, writeScope } from './phases'
import { describe } from './refusal'
import { git, relativeTo, treeHash } from './repo'
import type { Repo } from './repo'
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

type ScopeWatch = { repo: Repo; indexFile: string; phase: string; scope: string[]; tree: string }

async function watchScope($: EngineInterface): Promise<ScopeWatch | undefined> {
  try {
    const context = await loadContext($)
    const workflow = context?.current
    if (context === undefined || workflow === undefined || workflow.status !== 'active') return undefined
    const scope = writeScope(await readPhase($, workflow.phase), workflow, context.config?.specsDir ?? DEFAULT_SPECS_DIR)
    if (scope.length === 0 || scope.includes('**')) return undefined
    const tree = await treeHash($, context.repo, context.paths.treeIndex)
    return { repo: context.repo, indexFile: context.paths.treeIndex, phase: workflow.phase, scope, tree }
  } catch {
    return undefined
  }
}

async function scopeNotes($: EngineInterface, watch: ScopeWatch): Promise<string[]> {
  try {
    const tree = await treeHash($, watch.repo, watch.indexFile)
    if (tree === watch.tree) return []
    const changed = await git($, watch.repo.root, ['diff-tree', '-r', '--name-only', watch.tree, tree])
    const outside = changed.stdout.split('\n').filter(file => file.length > 0 && !matchesAny(file, watch.scope))
    if (outside.length === 0) return []
    return [
      `workflow: this command changed ${outside.join(', ')}, outside what the ${watch.phase} phase may write (${watch.scope.join(', ')}). Undo it unless the user asked for it: code starts in the build phase.`,
    ]
  } catch {
    return []
  }
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
    const watch = await watchScope($)
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const context = await loadContext($)
    if (context?.current === undefined) return ran
    const notes = [
      ...(watch === undefined ? [] : await scopeNotes($, watch)),
      ...(await afterShell($, context, e.command, ran, await $.clock.now())),
    ]
    if (notes.length === 0) return ran
    await refreshStatus($, context)
    return { ...ran, context: [...(ran.context ?? []), ...notes] }
  })
}
