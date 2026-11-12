import type { EngineInterface, On } from 'claude-code'

import { afterShell } from './build'
import { DEFAULT_SPECS_DIR, loadContext } from './context'
import { enteredWorktreeOf } from './ending'
import { matchesAny } from './glob'
import { readPhase, writeScope } from './phases'
import { describe } from './refusal'
import { findRepo, git, relativeTo, treeHash } from './repo'
import type { Repo } from './repo'
import type { Workflow } from './state'
import { refreshStatus } from './status'
import { listWorkflows, pathsFor, readLock } from './store'

function allowedWrites(scope: readonly string[]): string {
  return scope.length > 0 ? `may only write ${scope.join(', ')}` : 'writes no file in the repo'
}

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
  if (!matchesAny(file, scope)) {
    return `workflow: the ${workflow.phase} phase of "${workflow.slug}" ${allowedWrites(scope)}. Code starts in the build phase; if this change is needed now, ask the user.`
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
    if (scope.includes('**')) return undefined
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
      `workflow: this command changed ${outside.join(', ')}, and the ${watch.phase} phase ${allowedWrites(watch.scope)}. Undo it unless the user asked for it: code starts in the build phase.`,
    ]
  } catch {
    return []
  }
}

// ExitWorktree's remove deletes the worktree and its branch with none of the ending's checks (clean, pushed, the
// user's yes in the mod's dialog), so this guard refuses it for a workflow's worktree; a shell command that removes one
// is the permission system's to allow or not. The main checkout is never one: ExitWorktree cannot remove it, and an
// adopted workflow saves it as its worktree, so matching it would refuse every session worktree EnterWorktree creates
// inside it.
function heldWorktree(workflows: readonly Workflow[], repo: Repo): Workflow | undefined {
  if (!repo.isLinked) return undefined
  return workflows.find(workflow => workflow.status !== 'abandoned' && workflow.worktree === repo.root)
}

function heldRefusal(held: Workflow): string {
  return `workflow: ExitWorktree with action "remove" would delete the worktree of the workflow "${held.slug}" without checking that it is clean and pushed, or asking the user. Leave it with action "keep": \`/workflow done ${held.slug}\` offers to remove it once it is clean and pushed, and after the user's yes mcp__workflow__finish removes it.`
}

function unresolvedRefusal(what: string): string {
  return `workflow: ExitWorktree with action "remove" is refused: git could not resolve the repository of ${what}, so the mod cannot tell whether it is a workflow's worktree. Leave it with action "keep".`
}

// ExitWorktree removes the worktree the session entered, wherever a `cd` has since moved the shell, so the guard checks
// both the session folder and that worktree.
async function removalRefusal($: EngineInterface): Promise<string | undefined> {
  const context = await loadContext($)
  if (context === undefined) return unresolvedRefusal('the session folder')
  const here = heldWorktree(context.workflows, context.repo)
  if (here !== undefined) return heldRefusal(here)
  const entered = await enteredWorktreeOf($)
  if (entered === null) return undefined
  const repo = await findRepo($, entered)
  if (repo === undefined) return unresolvedRefusal(`the worktree ${entered} this session entered`)
  const target = heldWorktree(await listWorkflows($, pathsFor(repo)), repo)
  return target === undefined ? undefined : heldRefusal(target)
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

  on('tool.call', { tool: 'ExitWorktree' }, async ($, e, next) => {
    if (e.action !== 'remove') return next(e)
    const reason = await removalRefusal($)
    return reason === undefined ? next(e) : { deny: reason }
  }).catch(($, e, next) => (next.called ? next(e) : failed('ExitWorktree')))

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
