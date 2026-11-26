import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { askOrUndefined } from './ask'
import { day, iso } from './clock'
import type { Context } from './context'
import { ENDING } from './labels'
import { forgetRecommendations } from './picker'
import { describe, refuse } from './refusal'
import { deleteMergedBranch, findRepo, git, isClean, isDefaultBranch, isMergedInto, lines, relativeTo, removeWorktree } from './repo'
import type { Repo } from './repo'
import type { Runtime } from './runtime'
import { withLog } from './state'
import type { Lane, Workflow } from './state'
import { deleteWorkflow, updateWorkflow } from './store'

// ExitWorktree only leaves a worktree this session entered with EnterWorktree, and $.session.root() cannot tell: it
// follows a worktree move as well as a session started there.
const enteredWorktree = atom({ plugin: 'workflow', key: 'enteredWorktree' } as const, null, { shape: 'entered-worktree-1' })

const GIT_DIR_SUFFIX = '/.git'

export async function rememberEnteredWorktree($: EngineInterface, path: string): Promise<void> {
  await update($, enteredWorktree, () => path)
}

export function enteredWorktreeOf($: EngineInterface): Promise<string | null> {
  return read($, enteredWorktree)
}

function mainCheckout(repo: Repo): string | undefined {
  return repo.commonDir.endsWith(GIT_DIR_SUFFIX) ? repo.commonDir.slice(0, -GIT_DIR_SUFFIX.length) : undefined
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

async function problems($: EngineInterface, workflow: Workflow): Promise<string[]> {
  const { worktree, branch } = workflow
  if (!worktree.startsWith('/') || branch.startsWith('-')) return ['the state names a worktree or a branch the mod does not pass to git']
  if (isDefaultBranch(branch)) return [`${branch} is a default branch, which the mod never deletes`]
  const status = await git($, worktree, ['status', '--porcelain', '--untracked-files=normal'])
  if (status.exitCode !== 0) return [`git could not read the status of ${worktree}`]
  const found: string[] = []
  const changes = lines(status.stdout).length
  if (changes > 0) found.push(`the worktree has ${counted(changes, 'uncommitted change')}`)
  const unpushed = await git($, worktree, ['rev-list', '@{u}..HEAD'])
  if (unpushed.exitCode !== 0) found.push(`the branch ${branch} has no upstream: push it with git push -u`)
  else if (lines(unpushed.stdout).length > 0) found.push(`${counted(lines(unpushed.stdout).length, 'commit')} of ${branch} not pushed`)
  return found
}

const IGNORED_PREFIX = '!! '

// git worktree remove deletes ignored files (.env, node_modules) without asking, so the dialog names them.
async function ignoredEntries($: EngineInterface, worktree: string): Promise<string[] | undefined> {
  const listed = await git($, worktree, ['status', '--ignored', '--porcelain'])
  if (listed.exitCode !== 0) return undefined
  const entries = lines(listed.stdout)
    .filter(line => line.startsWith(IGNORED_PREFIX))
    .map(line => {
      const [top = '', ...rest] = line.slice(IGNORED_PREFIX.length).split('/')
      return rest.length > 0 ? `${top}/` : top
    })
  return [...new Set(entries)]
}

// The user agreed to delete the ignored entries the question named, and only those.
async function unnamedIgnored($: EngineInterface, worktree: string, named: readonly string[]): Promise<string[]> {
  const ignored = await ignoredEntries($, worktree)
  if (ignored === undefined) return ['git could not list its ignored files']
  const unnamed = ignored.filter(entry => !named.includes(entry))
  return unnamed.length === 0 ? [] : [`ignored files the question did not name appeared since: ${unnamed.join(', ')}`]
}

// A path that reaches the worktree through a link, or a repository nested in it, is inside it: the session's place is
// the top level git resolves for its folder, never the folder's path.
async function sessionTopLevel($: EngineInterface): Promise<string | undefined> {
  return (await findRepo($, await $.session.cwd()))?.root
}

function againLater(workflow: Workflow): string {
  return `\`/workflow delete ${workflow.slug}\` offers to remove them again.`
}

const UNRESOLVED_SESSION = 'git could not resolve the repository of the session folder'

// `refs/heads/` keeps a tag of the same name from standing in for the branch. `<branch>@{u}` reads the branch's own
// upstream setting, and git refuses `refs/heads/<branch>@{u}`.
async function deleteBranch($: EngineInterface, main: string, branch: string): Promise<string | undefined> {
  const local = await git($, main, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
  const upstream = await git($, main, ['rev-parse', '--verify', '--quiet', `${branch}@{u}`])
  if (local.exitCode !== 0 || upstream.exitCode !== 0 || local.stdout.trim() !== upstream.stdout.trim()) {
    return "it does not point at its upstream's commit"
  }
  const deleted = await git($, main, ['branch', '-D', branch])
  return deleted.exitCode === 0 ? undefined : `git could not delete it: ${deleted.stderr.trim()}`
}

type Removal = { removed: true; text: string } | { removed: false; reason: string; text: string }

async function remove(
  $: EngineInterface,
  context: Context,
  workflow: Workflow,
  agreed: { main: string; named: readonly string[] },
  now: number,
): Promise<Removal> {
  const { worktree, branch } = workflow
  const { main, named } = agreed
  const found = await problems($, workflow)
  if (found.length === 0) found.push(...(await unnamedIgnored($, worktree, named)))
  if (found.length > 0) {
    const reason = found.join('; ')
    return { removed: false, reason, text: `Removed nothing: ${reason}. Once that is fixed, ${againLater(workflow)}` }
  }
  const removed = await git($, main, ['worktree', 'remove', worktree])
  if (removed.exitCode !== 0) {
    const reason = `git could not remove the worktree ${worktree}: ${removed.stderr.trim()}`
    return { removed: false, reason, text: `Removed nothing: ${reason}. The branch ${branch} is kept.` }
  }
  const kept = await deleteBranch($, main, branch)
  await updateWorkflow($, context.paths, workflow.slug, current => {
    const logged = withLog({ ...current, updated: iso(now) }, day(now), 'worktree removed')
    return kept === undefined ? withLog(logged, day(now), `branch ${branch} deleted`) : logged
  })
  return {
    removed: true,
    text:
      kept === undefined
        ? `Removed the worktree ${worktree} and the local branch ${branch}.`
        : `Removed the worktree ${worktree}, and kept the local branch ${branch}: ${kept}.`,
  }
}

async function laneProblem($: EngineInterface, cwd: string, workflow: Workflow, lane: Lane): Promise<string | undefined> {
  if (!lane.worktree.startsWith('/') || lane.branch.startsWith('-')) return 'the state names a worktree or a branch the mod does not pass to git'
  if (!(await isMergedInto($, cwd, lane.branch, workflow.branch))) return `${lane.branch} is not merged into ${workflow.branch}`
  if ((await $.fs.exists(lane.worktree)) && !(await isClean($, lane.worktree))) return 'uncommitted changes'
  return undefined
}

async function removeLane($: EngineInterface, cwd: string, lane: Lane): Promise<string | undefined> {
  if (await $.fs.exists(lane.worktree)) {
    const failed = await removeWorktree($, cwd, lane.worktree)
    if (failed !== undefined) return failed
  }
  return deleteMergedBranch($, cwd, lane.branch)
}

// A lane left when a workflow ends goes when it is clean and the workflow branch holds its branch; any other stays for
// the user. `git branch -d` checks the branch against HEAD, so it runs in the workflow's worktree while it exists.
export async function removeLanes($: EngineInterface, context: Context, workflow: Workflow, now: number): Promise<string> {
  if (workflow.lanes.length === 0) return ''
  const cwd = (await $.fs.exists(workflow.worktree)) ? workflow.worktree : (mainCheckout(context.repo) ?? context.repo.root)
  const removed: number[] = []
  const kept: string[] = []
  for (const lane of workflow.lanes) {
    let problem: string | undefined
    try {
      problem = (await laneProblem($, cwd, workflow, lane)) ?? (await removeLane($, cwd, lane))
    } catch (error) {
      problem = describe(error)
    }
    if (problem === undefined) removed.push(lane.slice)
    else kept.push(`${lane.worktree} (${problem})`)
  }
  if (removed.length > 0) {
    await updateWorkflow($, context.paths, workflow.slug, current =>
      withLog({ ...current, lanes: current.lanes.filter(lane => !removed.includes(lane.slice)), updated: iso(now) }, day(now), `lanes removed: ${removed.join(', ')}`),
    )
  }
  const gone = workflow.lanes.filter(lane => removed.includes(lane.slice)).map(lane => `Removed the lane worktree ${lane.worktree} and its branch ${lane.branch}.`)
  const left = kept.length === 0 ? [] : [`Kept the lanes ${kept.join(', ')}: remove them by hand once you no longer need them.`]
  return [...gone, ...left].join(' ')
}

// Deleting the record takes the state, the test lock, the run log and what the mod remembers of the workflow; the
// committed files and the branch are git's.
export async function forget($: EngineInterface, context: Context, workflow: Workflow): Promise<void> {
  const main = mainCheckout(context.repo)
  const roots = [context.repo.root, workflow.worktree, ...(main === undefined ? [] : [main])]
  await deleteWorkflow($, context.paths, workflow, roots)
  await forgetRecommendations($, workflow.slug)
}

function leavePrompt(workflow: Workflow, main: string, purpose: Purpose): string {
  const after = purpose === 'delete' ? ', then deletes the workflow' : ''
  return [
    `The user agreed to remove the worktree ${workflow.worktree} and the local branch ${workflow.branch}.`,
    `Call the ExitWorktree tool with \`action\` set to "keep", never "remove": the mod removes them itself once it has checked them again${after}.`,
    'Then call mcp__workflow__finish and tell the user what it answers.',
    `If ExitWorktree is refused or fails, do not call mcp__workflow__finish: tell the user to run \`/workflow delete ${workflow.slug}\` from a session in the main checkout ${main}.`,
  ].join(' ')
}

function startedInside(workflow: Workflow, main: string): string {
  return `this session started inside the worktree ${workflow.worktree} and cannot leave it: run \`/workflow delete ${workflow.slug}\` from a session in the main checkout ${main}`
}

// close: the workflow just ended, and its record stays. delete: /workflow delete is removing the record, so a dismissed
// question cancels it and nothing asks again later.
export type Purpose = 'close' | 'delete'

// `beforeRemoval` runs once the user agreed and before the mod removes the worktree: what needs it, such as `git branch
// -d` checking a lane against the workflow branch, goes there.

export type Ending =
  | { kind: 'said'; text: string }
  | { kind: 'blocked'; reason: string; text: string }
  | { kind: 'cancelled' }
  | { kind: 'leave'; prompt: string }

export async function offerEnding(
  $: EngineInterface,
  runtime: Runtime,
  context: Context,
  workflow: Workflow,
  now: number,
  purpose: Purpose = 'close',
  beforeRemoval: () => Promise<void> = async () => undefined,
): Promise<Ending> {
  const { worktree, branch } = workflow
  const later = purpose === 'close' ? ` ${againLater(workflow)}` : ''
  const blocked = (reason: string, text = `Kept the worktree ${worktree} and the branch ${branch}: ${reason}.${later}`): Ending => ({
    kind: 'blocked',
    reason,
    text,
  })
  const main = mainCheckout(context.repo)
  if (main === undefined) return blocked(`the main checkout of this repo could not be found from ${context.repo.commonDir}`)
  if (worktree === main || !(await $.fs.exists(worktree))) return { kind: 'said', text: '' }
  const found = await problems($, workflow)
  if (found.length > 0) return blocked(found.join('; '))
  const ignored = await ignoredEntries($, worktree)
  if (ignored === undefined) return blocked('git could not list its ignored files')
  const answer = await askOrUndefined($, ENDING.question(worktree, branch, ignored), [ENDING.remove, ENDING.keep], 'Worktree')
  if (answer === undefined && purpose === 'delete') return { kind: 'cancelled' }
  if (answer !== ENDING.remove) return { kind: 'said', text: `Kept the worktree ${worktree} and the branch ${branch}.${later}` }
  const toplevel = await sessionTopLevel($)
  if (toplevel === undefined) return blocked(UNRESOLVED_SESSION)
  if (relativeTo(worktree, toplevel) === undefined) {
    await beforeRemoval()
    const removal = await remove($, context, workflow, { main, named: ignored }, now)
    return removal.removed ? { kind: 'said', text: removal.text } : blocked(removal.reason, removal.text)
  }
  if ((await read($, enteredWorktree)) !== worktree) {
    const reason = startedInside(workflow, main)
    return blocked(reason, `Nothing was removed: ${reason}.`)
  }
  runtime.agreedRemoval = { slug: workflow.slug, ignored, forget: purpose === 'delete' }
  return { kind: 'leave', prompt: leavePrompt(workflow, main, purpose) }
}

export async function finish($: EngineInterface, runtime: Runtime, context: Context, now: number): Promise<string> {
  const agreed = runtime.agreedRemoval
  if (agreed === undefined) refuse('the user has not agreed to remove a worktree in this session: nothing was removed. `/workflow delete <slug>` asks them.')
  const workflow = context.workflows.find(candidate => candidate.slug === agreed.slug)
  const main = mainCheckout(context.repo)
  // Only /workflow delete removes the worktree of a workflow that is not done: the user asked to delete it whole.
  if (workflow === undefined || (workflow.status !== 'done' && !agreed.forget) || main === undefined) {
    runtime.agreedRemoval = undefined
    refuse(`"${agreed.slug}" is not a finished workflow of this repo: nothing was removed.`)
  }
  const toplevel = await sessionTopLevel($)
  if (toplevel === undefined) refuse(`${UNRESOLVED_SESSION}, so the mod cannot tell whether the session left the worktree ${workflow.worktree}. Nothing was removed.`)
  if (relativeTo(workflow.worktree, toplevel) !== undefined) {
    refuse(`the session is still inside the worktree ${workflow.worktree}: call ExitWorktree with \`action\` set to "keep" first, then mcp__workflow__finish again. Nothing was removed.`)
  }
  runtime.agreedRemoval = undefined
  const removal = await remove($, context, workflow, { main, named: agreed.ignored }, now)
  if (!removal.removed || !agreed.forget) return removal.text
  await forget($, context, workflow)
  return `${removal.text} Deleted the workflow "${workflow.slug}".`
}
