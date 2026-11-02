import type { EngineInterface, On, PromptOrigin } from 'claude-code'

import { ask, askOrUndefined } from './ask'
import { unlockFile } from './build'
import { clearThenSubmit, day, iso, submitLater } from './clock'
import { DEFAULT_SPECS_DIR, isOpen, loadContext, readSlices } from './context'
import type { Context } from './context'
import { age, driftFacts } from './drift'
import { ADOPT, BRANCH, COMMITS, RETRO, SIZE, SWITCH, WORKTREE } from './labels'
import { pausePrompt, phasePrompt, setupPrompt } from './prompts'
import { Refusal, describe, refuse } from './refusal'
import { addWorktree, isDefaultBranch, switchBranch } from './repo'
import type { Runtime } from './runtime'
import { parseSlices } from './slices'
import { firstPhase, slugify, withLog } from './state'
import type { Phase, Size, Workflow } from './state'
import { phaseLabel, refreshStatus } from './status'
import { openWorkflowsEverywhere, saveWorkflow } from './store'
import { registerToolsOnce } from './tools'

const RECENT_MS = 30 * 60_000

const USAGE = [
  'Usage:',
  '- /workflow: the workflows of this repo',
  '- /workflow all: open workflows in every repo',
  '- /workflow new <title>: start one',
  '- /workflow continue [slug]: resume one',
  '- /workflow next: clear the context and continue',
  '- /workflow pause: write the handoff and stop',
  '- /workflow unlock <file> <reason>: unlock a locked test yourself',
  '- /workflow done <slug>, /workflow abandon <slug> <reason>: close one',
  '- /workflow adopt: set up this project, or rebuild workflows from their specs',
].join('\n')

type Session = { context: Context; now: number; runtime: Runtime }

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(word => word.length > 0)
}

async function status($: EngineInterface, { context, now }: Session): Promise<string> {
  if (context.workflows.length === 0) return 'workflow: no workflow in this repo. /workflow new <title> starts one.'
  const rows: string[] = []
  for (const workflow of context.workflows) {
    const here = workflow.branch === context.repo.branch ? ' (current branch)' : ''
    rows.push(`- ${workflow.slug}: ${await phaseLabel($, context, workflow)}, ${workflow.status}, updated ${age(workflow.updated, now)}${here}`)
  }
  return ['Workflows in this repo:', ...rows].join('\n')
}

async function all($: EngineInterface, now: number): Promise<string> {
  const open = (await openWorkflowsEverywhere($)).filter(entry => entry.status === 'active' || entry.status === 'paused')
  if (open.length === 0) return 'workflow: no open workflow anywhere.'
  return ['Open workflows:', ...open.map(entry => `- ${entry.root}: ${entry.slug} (${entry.phase}), updated ${age(entry.updated, now)}`)].join('\n')
}

async function placement($: EngineInterface, session: Session, slug: string): Promise<{ branch: string; worktree: string; here: boolean }> {
  const { context } = session
  const branch = `feat/${slug}`
  if (context.current !== undefined) {
    const choice = await ask($, `This checkout runs "${context.current.slug}". Where should the new workflow go?`, [WORKTREE.create, WORKTREE.here], 'Checkout')
    if (choice === WORKTREE.create) {
      const folder = context.repo.root.split('/').pop() ?? 'repo'
      const path = `${context.repo.root.slice(0, context.repo.root.length - folder.length)}${folder}-${slug}`
      await addWorktree($, context.repo, branch, path)
      return { branch, worktree: path, here: false }
    }
  }
  const options = isDefaultBranch(context.repo.branch)
    ? [BRANCH.create(branch), BRANCH.stay(context.repo.branch)]
    : [BRANCH.stay(context.repo.branch), BRANCH.create(branch)]
  const choice = await ask($, `Which branch should "${slug}" use?`, options, 'Branch')
  if (choice === BRANCH.create(branch)) {
    await switchBranch($, context.repo, branch, true)
    return { branch, worktree: context.repo.root, here: true }
  }
  return { branch: context.repo.branch, worktree: context.repo.root, here: true }
}

async function start($: EngineInterface, session: Session, title: string): Promise<string> {
  const { context, now, runtime } = session
  const slug = slugify(title)
  if (slug.length === 0) return 'workflow: give the workflow a title: /workflow new <title>'
  if (context.workflows.some(workflow => workflow.slug === slug)) {
    return `workflow: "${slug}" exists already. /workflow continue ${slug} resumes it.`
  }
  let size: Size
  let commits: boolean
  let where: Awaited<ReturnType<typeof placement>>
  try {
    size = (await ask($, SIZE.question(title), [SIZE.feature, SIZE.project], 'Size')) === SIZE.project ? 'project' : 'feature'
    commits = (await ask($, COMMITS.question, [COMMITS.yes, COMMITS.no], 'Commits')) === COMMITS.yes
    where = await placement($, session, slug)
  } catch (error) {
    return error instanceof Error && error.message.startsWith('git ')
      ? `workflow: ${error.message}. Nothing was created.`
      : 'workflow: cancelled, nothing was created.'
  }

  const phase = firstPhase(size, context.config === undefined)
  const workflow: Workflow = {
    slug,
    title,
    size,
    phase,
    status: 'active',
    branch: where.branch,
    worktree: where.worktree,
    slice: 0,
    commits,
    autoNext: false,
    paths: [],
    session: await $.session.id(),
    updated: iso(now),
    goal: title,
    docs: [],
    stopped: 'Not started.',
    next: `Start the ${phase} phase.`,
    questions: [],
    log: [`${day(now)} created (${size})`],
  }
  await saveWorkflow($, context.repo, context.paths, workflow)
  await registerToolsOnce($, runtime)
  if (!where.here) {
    return `workflow: started "${slug}" (${size}) in the new worktree ${where.worktree} on ${where.branch}. Start a session there and run /workflow continue ${slug}.`
  }
  const fresh = await loadContext($)
  await refreshStatus($, fresh)
  submitLater($, await phasePrompt($, fresh ?? context, workflow))
  return `workflow: started "${slug}" (${size}) on ${where.branch}, phase ${phase}.`
}

function pick(context: Context, slug: string | undefined): Workflow {
  if (slug !== undefined) {
    const named = context.workflows.find(workflow => workflow.slug === slug)
    if (named === undefined) refuse(`no workflow "${slug}" here. /workflow lists them.`)
    return named
  }
  if (context.current !== undefined) return context.current
  const open = context.workflows.filter(isOpen)
  if (open.length === 1 && open[0] !== undefined) return open[0]
  if (open.length === 0) refuse('no workflow to continue here. /workflow new <title> starts one.')
  refuse(`several workflows are open: ${open.map(workflow => workflow.slug).join(', ')}. Name one: /workflow continue <slug>.`)
}

async function resume($: EngineInterface, session: Session, slug: string | undefined, clearFirst: boolean): Promise<string> {
  const { now } = session
  let context = session.context
  const target = pick(context, slug)
  if (!isOpen(target)) return `workflow: "${target.slug}" is ${target.status}.`
  if (target.branch !== context.repo.branch) {
    const answer = await askOrUndefined(
      $,
      `"${target.slug}" works on ${target.branch}, and this checkout is on ${context.repo.branch}. Switch?`,
      [SWITCH.yes(target.branch), SWITCH.no],
      'Branch',
    )
    if (answer !== SWITCH.yes(target.branch)) return `workflow: stayed on ${context.repo.branch}; nothing changed.`
    await switchBranch($, context.repo, target.branch, false)
    context = (await loadContext($)) ?? context
  }

  const sessionId = await $.session.id()
  const elsewhere =
    target.session !== sessionId && now - Date.parse(target.updated) < RECENT_MS
      ? ` Another session worked on it ${Math.round((now - Date.parse(target.updated)) / 60_000)} minutes ago: make sure it has stopped.`
      : ''
  const drift = await driftFacts($, context, target, now)
  let slice = target.slice
  if (target.phase === 'build' && slice === 0) {
    slice = (await readSlices($, context, target)).find(candidate => !candidate.done)?.number ?? 1
  }
  const resumed: Workflow = { ...target, status: 'active', session: sessionId, slice, updated: iso(now) }
  await saveWorkflow($, context.repo, context.paths, resumed)
  await refreshStatus($)
  const prompt = await phasePrompt($, context, resumed, drift)
  if (clearFirst) clearThenSubmit($, prompt)
  else submitLater($, prompt)
  const action = clearFirst ? 'clearing the context, then continuing' : 'continuing'
  return `workflow: ${action} "${target.slug}": ${await phaseLabel($, context, resumed)}.${elsewhere}`
}

async function pause($: EngineInterface, { context, now }: Session, slug: string | undefined): Promise<string> {
  const target = pick(context, slug)
  await saveWorkflow($, context.repo, context.paths, withLog({ ...target, status: 'paused', updated: iso(now) }, day(now), 'paused'))
  await refreshStatus($)
  submitLater($, pausePrompt(target))
  return `workflow: pausing "${target.slug}". Claude writes the handoff, then stops.`
}

async function close($: EngineInterface, session: Session, slug: string | undefined, reason: string, abandon: boolean): Promise<string> {
  const { context, now } = session
  const target = pick(context, slug)
  if (abandon) {
    const closed = withLog({ ...target, status: 'abandoned', updated: iso(now) }, day(now), `abandoned: ${reason || 'no reason given'}`)
    await saveWorkflow($, context.repo, context.paths, closed)
    await refreshStatus($)
    return `workflow: abandoned "${target.slug}".`
  }
  if (target.size === 'project' && target.phase !== 'retro' && target.phase !== 'done') {
    const answer = await askOrUndefined($, `Run the retro of "${target.slug}" before closing it?`, [RETRO.run, RETRO.close], 'Retro')
    if (answer === undefined) return 'workflow: cancelled, nothing changed.'
    if (answer === RETRO.run) {
      const retro: Workflow = { ...target, phase: 'retro', status: 'active', updated: iso(now) }
      await saveWorkflow($, context.repo, context.paths, withLog(retro, day(now), 'retro started'))
      await refreshStatus($)
      submitLater($, await phasePrompt($, context, retro))
      return `workflow: starting the retro of "${target.slug}".`
    }
  }
  const done: Workflow = { ...target, phase: 'done', status: 'done', updated: iso(now) }
  await saveWorkflow($, context.repo, context.paths, withLog(done, day(now), 'done'))
  await refreshStatus($)
  return `workflow: "${target.slug}" is done.`
}

function byThePerson(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge'
}

async function unlock($: EngineInterface, session: Session, args: string[], origin: PromptOrigin): Promise<string> {
  if (!byThePerson(origin)) return 'workflow: only the user unlocks a test, by typing /workflow unlock. Claude asks with mcp__workflow__unlock.'
  const [file, ...reason] = args
  if (file === undefined) return 'workflow: /workflow unlock <file> <reason>'
  return `workflow: ${await unlockFile($, session.context, file, reason.join(' ') || 'unlocked by the user', true, session.now)}`
}

function inferred(files: ReadonlySet<string>, slicesText: string): { size: Size; phase: Phase; slice: number } {
  const size: Size = files.has('spec.md') ? 'project' : 'feature'
  if (files.has('slices.md')) {
    const slices = parseSlices(slicesText)
    const open = slices.find(slice => !slice.done)
    return open === undefined ? { size, phase: 'inspect', slice: slices.length } : { size, phase: 'build', slice: open.number }
  }
  if (files.has('design.md')) return { size, phase: 'slice', slice: 0 }
  if (files.has('spec.md')) return { size, phase: 'design', slice: 0 }
  return { size, phase: firstPhase(size, false), slice: 0 }
}

async function adopt($: EngineInterface, session: Session): Promise<string> {
  const { context, now, runtime } = session
  const report: string[] = []
  const specsDir = context.config?.specsDir ?? DEFAULT_SPECS_DIR
  let folders: string[] = []
  try {
    folders = (await $.fs.list(`${context.repo.root}/${specsDir}`)).filter(entry => entry.kind === 'dir').map(entry => entry.name)
  } catch {
    folders = []
  }
  for (const slug of folders.filter(name => !context.workflows.some(workflow => workflow.slug === name))) {
    const answer = await askOrUndefined($, `Rebuild a workflow for ${specsDir}/${slug}? Its documents are here, its state is not.`, [ADOPT.rebuild, ADOPT.skip], 'Adopt')
    if (answer !== ADOPT.rebuild) continue
    const names = new Set((await $.fs.list(`${context.repo.root}/${specsDir}/${slug}`)).map(entry => entry.name))
    const slicesText = names.has('slices.md') ? await $.fs.read(`${context.repo.root}/${specsDir}/${slug}/slices.md`) : ''
    const { size, phase, slice } = inferred(names, slicesText)
    const workflow: Workflow = {
      slug,
      title: slug,
      size,
      phase,
      status: 'active',
      branch: context.repo.branch,
      worktree: context.repo.root,
      slice,
      commits: false,
      autoNext: false,
      paths: [],
      session: await $.session.id(),
      updated: iso(now),
      goal: '',
      docs: [...names].map(name => `${specsDir}/${slug}/${name}`),
      stopped: 'Rebuilt by /workflow adopt from the committed documents.',
      next: `Check the rebuilt state, then continue the ${phase} phase.`,
      questions: [],
      log: [`${day(now)} rebuilt by adopt`],
    }
    await saveWorkflow($, context.repo, context.paths, workflow)
    report.push(`rebuilt ${slug} (${phase}${phase === 'build' ? `, slice ${slice}` : ''}, on ${context.repo.branch})`)
  }
  if (report.length > 0) {
    await registerToolsOnce($, runtime)
    await refreshStatus($)
  }
  if (context.config === undefined) {
    submitLater($, await setupPrompt($))
    report.push('no .claude/workflow.json yet: Claude runs the setup phase')
  }
  return report.length > 0 ? `workflow: ${report.join('; ')}.` : 'workflow: nothing to adopt here: the setup exists and every spec folder has its workflow.'
}

async function dispatch($: EngineInterface, session: Session, args: string, origin: PromptOrigin): Promise<string> {
  const [subcommand = 'status', ...rest] = words(args)
  switch (subcommand) {
    case 'status':
      return status($, session)
    case 'new':
      return start($, session, rest.join(' '))
    case 'continue':
      return resume($, session, rest[0], false)
    case 'next':
      return resume($, session, rest[0], true)
    case 'pause':
      return pause($, session, rest[0])
    case 'unlock':
      return unlock($, session, rest, origin)
    case 'done':
      return close($, session, rest[0], '', false)
    case 'abandon':
      return close($, session, rest[0], rest.slice(1).join(' '), true)
    case 'adopt':
      return adopt($, session)
    default:
      return USAGE
  }
}

export async function registerCommand($: EngineInterface): Promise<void> {
  await $.command.register({
    name: 'workflow',
    description: "This repo's workflows; new, continue, next, pause, unlock, done, abandon, adopt, all.",
    argumentHint: '[new <title> | continue [slug] | next | pause | unlock <file> <reason> | done | abandon | adopt | all]',
  })
}

export function registerCommands(on: On, runtime: Runtime): void {
  on('command.run', { command: 'workflow' }, async ($, e) => {
    try {
      const now = await $.clock.now()
      if (words(e.args)[0] === 'all') return { text: await all($, now) }
      const context = await loadContext($)
      if (context === undefined) {
        return { text: 'workflow: this folder is not in a git repository. Run git init, then /workflow new <title>.' }
      }
      return { text: await dispatch($, { context, now, runtime }, e.args, e.origin) }
    } catch (error) {
      return { text: error instanceof Refusal ? `workflow: ${error.message}` : `workflow: ${describe(error)}` }
    }
  })
}
