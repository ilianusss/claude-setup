import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { askOrUndefined } from './ask'
import { day, iso } from './clock'
import type { Context } from './context'
import { ENDING } from './labels'
import { refuse } from './refusal'
import { git, isDefaultBranch, lines, relativeTo } from './repo'
import type { Repo } from './repo'
import type { Runtime } from './runtime'
import { withLog } from './state'
import type { Workflow } from './state'
import { saveWorkflow } from './store'

export type Ending = { kind: 'said'; text: string } | { kind: 'leave'; prompt: string }

// ExitWorktree only leaves a worktree this session entered with EnterWorktree, and $.session.root() cannot tell: it
// follows a worktree move as well as a session started there.
const enteredWorktree = atom({ plugin: 'workflow', key: 'enteredWorktree' } as const, null, { shape: 'entered-worktree-1' })

const GIT_DIR_SUFFIX = '/.git'

export async function rememberEnteredWorktree($: EngineInterface, path: string): Promise<void> {
  await update($, enteredWorktree, () => path)
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

function againLater(workflow: Workflow): string {
  return `\`/workflow done ${workflow.slug}\` offers to remove them again.`
}

async function deleteBranch($: EngineInterface, main: string, branch: string): Promise<string | undefined> {
  const local = await git($, main, ['rev-parse', '--verify', '--quiet', branch])
  const upstream = await git($, main, ['rev-parse', '--verify', '--quiet', `${branch}@{u}`])
  if (local.exitCode !== 0 || upstream.exitCode !== 0 || local.stdout.trim() !== upstream.stdout.trim()) {
    return "it does not point at its upstream's commit"
  }
  const deleted = await git($, main, ['branch', '-D', branch])
  return deleted.exitCode === 0 ? undefined : `git could not delete it: ${deleted.stderr.trim()}`
}

async function remove($: EngineInterface, context: Context, workflow: Workflow, main: string, now: number): Promise<string> {
  const { worktree, branch } = workflow
  const found = await problems($, workflow)
  if (found.length > 0) return `Removed nothing: ${found.join('; ')}. Once that is fixed, ${againLater(workflow)}`
  const removed = await git($, main, ['worktree', 'remove', worktree])
  if (removed.exitCode !== 0) {
    return `Removed nothing: git could not remove the worktree ${worktree}: ${removed.stderr.trim()}. The branch ${branch} is kept.`
  }
  const logged = withLog({ ...workflow, updated: iso(now) }, day(now), 'worktree removed')
  const kept = await deleteBranch($, main, branch)
  await saveWorkflow($, context.repo, context.paths, kept === undefined ? withLog(logged, day(now), `branch ${branch} deleted`) : logged)
  return kept === undefined
    ? `Removed the worktree ${worktree} and the local branch ${branch}.`
    : `Removed the worktree ${worktree}, and kept the local branch ${branch}: ${kept}.`
}

function leavePrompt(workflow: Workflow, main: string): string {
  return [
    `The user agreed to remove the worktree ${workflow.worktree} and the local branch ${workflow.branch}.`,
    'Call the ExitWorktree tool with `action` set to "keep", never "remove": the mod removes them itself once it has checked them again.',
    'Then call mcp__workflow__finish and tell the user what it answers.',
    `If ExitWorktree is refused or fails, do not call mcp__workflow__finish: tell the user to run \`/workflow done ${workflow.slug}\` from a session in the main checkout ${main}.`,
  ].join(' ')
}

function startedInside(workflow: Workflow, main: string): string {
  return `This session started inside the worktree ${workflow.worktree} and cannot leave it, so nothing was removed: run \`/workflow done ${workflow.slug}\` from a session in the main checkout ${main}.`
}

export async function offerEnding($: EngineInterface, runtime: Runtime, context: Context, workflow: Workflow, now: number): Promise<Ending> {
  const main = mainCheckout(context.repo)
  if (workflow.worktree === main) return { kind: 'said', text: '' }
  const { worktree, branch } = workflow
  const found = main === undefined ? [`the main checkout of this repo could not be found from ${context.repo.commonDir}`] : await problems($, workflow)
  if (main === undefined || found.length > 0) {
    return { kind: 'said', text: `Kept the worktree ${worktree} and the branch ${branch}: ${found.join('; ')}. Once that is fixed, ${againLater(workflow)}` }
  }
  const ignored = await ignoredEntries($, worktree)
  if (ignored === undefined) {
    return { kind: 'said', text: `Kept the worktree ${worktree} and the branch ${branch}: git could not list its ignored files. ${againLater(workflow)}` }
  }
  const answer = await askOrUndefined($, ENDING.question(worktree, branch, ignored), [ENDING.remove, ENDING.keep], 'Worktree')
  if (answer !== ENDING.remove) return { kind: 'said', text: `Kept the worktree ${worktree} and the branch ${branch}. ${againLater(workflow)}` }
  if (relativeTo(worktree, await $.session.cwd()) === undefined) return { kind: 'said', text: await remove($, context, workflow, main, now) }
  if ((await read($, enteredWorktree)) !== worktree) return { kind: 'said', text: startedInside(workflow, main) }
  runtime.agreedRemoval = workflow.slug
  return { kind: 'leave', prompt: leavePrompt(workflow, main) }
}

export async function finish($: EngineInterface, runtime: Runtime, context: Context, now: number): Promise<string> {
  const slug = runtime.agreedRemoval
  if (slug === undefined) refuse('the user has not agreed to remove a worktree in this session: nothing was removed. `/workflow done <slug>` asks them.')
  const workflow = context.workflows.find(candidate => candidate.slug === slug)
  const main = mainCheckout(context.repo)
  if (workflow === undefined || workflow.status !== 'done' || main === undefined) {
    runtime.agreedRemoval = undefined
    refuse(`"${slug}" is not a finished workflow of this repo: nothing was removed.`)
  }
  if (relativeTo(workflow.worktree, await $.session.cwd()) !== undefined) {
    refuse(`the session is still inside the worktree ${workflow.worktree}: call ExitWorktree with \`action\` set to "keep" first, then mcp__workflow__finish again. Nothing was removed.`)
  }
  runtime.agreedRemoval = undefined
  return remove($, context, workflow, main, now)
}
