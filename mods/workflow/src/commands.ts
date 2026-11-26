import type { EngineInterface, On, PromptOrigin } from 'claude-code'

import { registerAgents, registerAgentsFor } from './agents'
import { ask, askOrUndefined } from './ask'
import { unlockFile } from './build'
import { clearThenSubmit, day, iso, submitLater } from './clock'
import { DEFAULT_SPECS_DIR, isOpen, loadContext, readSlices } from './context'
import type { Context } from './context'
import { age, driftFacts } from './drift'
import { forget, offerEnding, removeLanes } from './ending'
import { mergeWaitingLanes } from './lanes'
import { ADOPT, BRANCH, CHAINING, COMMITS, DELETE, DOCS, PROMPTING, SIZE, SWITCH, TECHNICAL } from './labels'
import { chooseModels, recommendationsFor } from './picker'
import { DEFAULT_PLAN, renderPlan } from './plan'
import { enterWorktreePrompt, pausePrompt, phasePrompt, setupPrompt } from './prompts'
import { Refusal, describe, refuse } from './refusal'
import { addWorktree, isDefaultBranch, switchBranch } from './repo'
import type { Runtime } from './runtime'
import { parseSlices } from './slices'
import { slugify, withLog } from './state'
import type { KeepDocs, Phase, Prompting, Size, Workflow } from './state'
import { announcePhase, phaseLabel, refreshStatus } from './status'
import { isPlainSlug, openWorkflowsEverywhere, saveWorkflow, updateWorkflow } from './store'
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
  '- /workflow models: choose the model and effort of each step',
  '- /workflow unlock <file> <reason>: unlock a locked test yourself',
  '- /workflow delete [slug]: delete one, done or not, and offer to remove its worktree',
  '- /workflow adopt: set up this project, or rebuild workflows from their specs',
].join('\n')

type Session = { context: Context; now: number; runtime: Runtime }

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(word => word.length > 0)
}

async function status($: EngineInterface, { context, now }: Session): Promise<string> {
  if (context.workflows.length === 0) return 'no workflow in this repo. /workflow new <title> starts one.'
  const rows: string[] = []
  for (const workflow of context.workflows) {
    const here = workflow.branch === context.repo.branch ? ' (current branch)' : ''
    rows.push(`- ${workflow.slug}: ${await phaseLabel($, context, workflow)}, ${workflow.status}, updated ${age(workflow.updated, now)}${here}`)
  }
  return ['Workflows in this repo:', ...rows].join('\n')
}

async function all($: EngineInterface, now: number): Promise<string> {
  const open = (await openWorkflowsEverywhere($)).filter(entry => entry.status === 'active' || entry.status === 'paused')
  if (open.length === 0) return 'no open workflow anywhere.'
  return ['Open workflows:', ...open.map(entry => `- ${entry.root}: ${entry.slug} (${entry.phase}), updated ${age(entry.updated, now)}`)].join('\n')
}

async function placement($: EngineInterface, session: Session, slug: string): Promise<{ branch: string; worktree: string; here: boolean }> {
  const { context } = session
  const branch = `feat/${slug}`
  // Work stays out of the main checkout, which may hold the person's own changes (CLAUDE.md, How to work).
  if (!context.repo.isLinked || context.current !== undefined) {
    const folder = context.repo.root.split('/').pop() ?? 'repo'
    const path = `${context.repo.root.slice(0, context.repo.root.length - folder.length)}${folder}-${slug}`
    await addWorktree($, context.repo, branch, path)
    return { branch, worktree: path, here: false }
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

const KEEP_DOCS_ANSWERS: ReadonlyArray<[string, KeepDocs]> = [
  [DOCS.all, 'all'],
  [DOCS.specs, 'specs'],
  [DOCS.code, 'code'],
  [DOCS.ask, 'ask'],
]

async function askKeepDocs($: EngineInterface): Promise<KeepDocs> {
  const answer = await ask($, DOCS.question, KEEP_DOCS_ANSWERS.map(([label]) => label), 'Documents')
  return KEEP_DOCS_ANSWERS.find(([label]) => label === answer)?.[1] ?? 'all'
}

async function askForTitle($: EngineInterface): Promise<string> {
  await $.prompt.fill({ text: '/workflow new ' })
  return 'name the workflow: type its title after /workflow new, then press Enter.'
}

async function start($: EngineInterface, session: Session, title: string): Promise<string> {
  const { context, now, runtime } = session
  const slug = slugify(title)
  if (slug.length === 0) return askForTitle($)
  if (context.workflows.some(workflow => workflow.slug === slug)) {
    return `"${slug}" exists already. /workflow continue ${slug} resumes it.`
  }
  let size: Size
  let prompting: Prompting
  let technical: boolean
  let commits: boolean
  let keepDocs: KeepDocs
  let autoNext: boolean
  let where: Awaited<ReturnType<typeof placement>>
  try {
    size = (await ask($, SIZE.question(title), [SIZE.feature, SIZE.project], 'Size')) === SIZE.project ? 'project' : 'feature'
    prompting = (await ask($, PROMPTING.question, [PROMPTING.all, PROMPTING.major], 'Prompting')) === PROMPTING.major ? 'major' : 'all'
    technical = (await ask($, TECHNICAL.question, [TECHNICAL.yes, TECHNICAL.no], 'Technical')) !== TECHNICAL.no
    commits = (await ask($, COMMITS.question, [COMMITS.yes, COMMITS.no], 'Commits')) === COMMITS.yes
    keepDocs = await askKeepDocs($)
    // Without technical decisions the user is not asked between slices either: the slices chain.
    autoNext = !technical || (await ask($, CHAINING.question, [CHAINING.yes, CHAINING.no], 'Next slice')) === CHAINING.yes
    where = await placement($, session, slug)
  } catch (error) {
    return error instanceof Error && error.message.startsWith('git ')
      ? `${error.message}. Nothing was created.`
      : 'cancelled, nothing was created.'
  }

  const phase: Phase = 'intake'
  const workflow: Workflow = {
    slug,
    title,
    size,
    phase,
    status: 'active',
    branch: where.branch,
    worktree: where.worktree,
    slice: 0,
    prompting,
    technical,
    commits,
    autoNext,
    keepDocs,
    models: DEFAULT_PLAN,
    paths: [],
    lanes: [],
    session: await $.session.id(),
    updated: iso(now),
    goal: title,
    docs: [],
    stopped: 'Not started.',
    next: `Start the ${phase} phase.`,
    questions: [],
    log: [`${day(now)} created (${size})`],
  }
  await saveWorkflow($, context.paths, workflow)
  await registerToolsOnce($, runtime)
  announcePhase($, workflow)
  const fresh = (await loadContext($)) ?? context
  await registerAgentsFor($, fresh, workflow)
  if (!where.here) {
    submitLater($, enterWorktreePrompt(workflow, await phasePrompt($, fresh, workflow)))
    return `started "${slug}" (${size}) in the new worktree ${where.worktree} on ${where.branch}. Claude is moving the session there to start the intake.`
  }
  await refreshStatus($, fresh)
  submitLater($, await phasePrompt($, fresh, workflow))
  return `started "${slug}" (${size}) on ${where.branch}, phase ${phase}.`
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
  if (!isOpen(target)) return `"${target.slug}" is ${target.status}.`
  if (target.branch !== context.repo.branch) {
    const answer = await askOrUndefined(
      $,
      `"${target.slug}" works on ${target.branch}, and this checkout is on ${context.repo.branch}. Switch?`,
      [SWITCH.yes(target.branch), SWITCH.no],
      'Branch',
    )
    if (answer !== SWITCH.yes(target.branch)) return `stayed on ${context.repo.branch}; nothing changed.`
    await switchBranch($, context.repo, target.branch, false)
    context = (await loadContext($)) ?? context
  }

  const sessionId = await $.session.id()
  const elsewhere =
    target.session !== sessionId && now - Date.parse(target.updated) < RECENT_MS
      ? ` Another session worked on it ${Math.round((now - Date.parse(target.updated)) / 60_000)} minutes ago: make sure it has stopped.`
      : ''
  const merges = await mergeWaitingLanes($, context, target)
  const drift = await driftFacts($, context, target, now)
  let slice = target.slice
  if (target.phase === 'build' && slice === 0) {
    slice = (await readSlices($, context, target)).find(candidate => !candidate.done)?.number ?? 1
  }
  const resumed = await updateWorkflow($, context.paths, target.slug, current => ({
    ...current,
    status: 'active',
    session: sessionId,
    slice,
    updated: iso(now),
  }))
  await refreshStatus($)
  await registerAgents($)
  const phase = await phasePrompt($, context, resumed, drift)
  const prompt = merges === undefined ? phase : `${merges}\n\n${phase}`
  if (clearFirst) clearThenSubmit($, prompt)
  else submitLater($, prompt)
  const action = clearFirst ? 'clearing the context, then continuing' : 'continuing'
  return `${action} "${target.slug}": ${await phaseLabel($, context, resumed)}.${elsewhere}`
}

async function models($: EngineInterface, { context }: Session): Promise<string> {
  const workflow = context.current
  if (workflow === undefined) return 'no workflow runs on this branch. /workflow continue <slug> picks one.'
  const chosen = await chooseModels($, context, workflow, await recommendationsFor($, workflow.slug), 'stay')
  if (chosen === 'pane') return `choose the model and effort of each step of "${workflow.slug}" in the Models panel.`
  await registerAgents($)
  const plan = renderPlan(chosen.models).join(', ')
  return plan === renderPlan(workflow.models).join(', ') ? `the models of "${workflow.slug}" are unchanged.` : `the models of "${workflow.slug}" are now: ${plan}.`
}

async function pause($: EngineInterface, { context, now }: Session, slug: string | undefined): Promise<string> {
  const target = pick(context, slug)
  await updateWorkflow($, context.paths, target.slug, current => withLog({ ...current, status: 'paused', updated: iso(now) }, day(now), 'paused'))
  await refreshStatus($)
  submitLater($, pausePrompt(target))
  return `pausing "${target.slug}". Claude writes the handoff, then stops.`
}

function notDeleted(workflow: Workflow, reason?: string): string {
  return reason === undefined
    ? `Nothing was deleted. \`/workflow delete ${workflow.slug}\` asks again.`
    : `Nothing was deleted: ${reason}. Once that is fixed, \`/workflow delete ${workflow.slug}\` offers to remove the worktree again.`
}

// One command ends a workflow whatever its state: it deletes the record, after offering to remove the worktree, since
// once the record is gone the mod can no longer offer it.
async function remove($: EngineInterface, session: Session, slug: string | undefined): Promise<string> {
  const { context, now, runtime } = session
  const target = pick(context, slug)
  if (!isPlainSlug(target.slug)) return `cannot delete "${target.slug}": its name is not a plain file name. Delete ${context.paths.dir}/${target.slug}.md by hand.`
  const confirmed = await askOrUndefined($, DELETE.question(target.slug, target.status), [DELETE.yes, DELETE.no], 'Delete')
  if (confirmed !== DELETE.yes) return 'cancelled, nothing changed.'
  // The lanes go only once the delete is accepted, so a cancel leaves everything as it was, and before the workflow's
  // worktree goes, since `git branch -d` checks a lane against it.
  let lanes: string | undefined
  const removeTheLanes = async () => {
    lanes ??= await removeLanes($, context, target, now)
  }
  const withLanes = async (text: string) => {
    await removeTheLanes()
    return lanes === undefined || lanes === '' ? text : `${lanes} ${text}`
  }
  const ending = await offerEnding($, runtime, context, target, now, 'delete', removeTheLanes)
  if (ending.kind === 'cancelled') return notDeleted(target)
  if (ending.kind === 'leave') {
    const said = await withLanes(`Claude leaves the worktree and removes it, then the mod deletes "${target.slug}".`)
    submitLater($, ending.prompt)
    return said
  }
  if (ending.kind === 'blocked') {
    const anyway = await askOrUndefined($, DELETE.blocked(target.worktree, ending.reason), [DELETE.anyway, DELETE.cancel], 'Delete')
    if (anyway !== DELETE.anyway) return notDeleted(target, ending.reason)
    const said = await withLanes(
      `Deleted the workflow "${target.slug}", and kept the worktree ${target.worktree} and the branch ${target.branch}: remove them by hand when you no longer need them.`,
    )
    await forget($, context, target)
    await refreshStatus($)
    return said
  }
  const deleted = `Deleted the workflow "${target.slug}".`
  const said = await withLanes(ending.text === '' ? deleted : `${ending.text} ${deleted}`)
  await forget($, context, target)
  await refreshStatus($)
  return said
}

function byThePerson(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge'
}

async function unlock($: EngineInterface, session: Session, args: string[], origin: PromptOrigin): Promise<string> {
  if (!byThePerson(origin)) return 'only the user unlocks a test, by typing /workflow unlock. Claude asks with mcp__workflow__unlock.'
  const [file, ...reason] = args
  if (file === undefined) return '/workflow unlock <file> <reason>'
  return `${await unlockFile($, session.context, file, reason.join(' ') || 'unlocked by the user', true, session.now)}`
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
  return { size, phase: 'intake', slice: 0 }
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
      prompting: 'all',
      technical: true,
      commits: false,
      autoNext: false,
      keepDocs: 'all',
      models: DEFAULT_PLAN,
      paths: [],
      lanes: [],
      session: await $.session.id(),
      updated: iso(now),
      goal: '',
      docs: [...names].map(name => `${specsDir}/${slug}/${name}`),
      stopped: 'Rebuilt by /workflow adopt from the committed documents.',
      next: `Check the rebuilt state, then continue the ${phase} phase.`,
      questions: [],
      log: [`${day(now)} rebuilt by adopt`],
    }
    await saveWorkflow($, context.paths, workflow)
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
  return report.length > 0 ? `${report.join('; ')}.` : 'nothing to adopt here: the setup exists and every spec folder has its workflow.'
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
    case 'models':
      return models($, session)
    case 'unlock':
      return unlock($, session, rest, origin)
    case 'delete':
      return remove($, session, rest[0])
    case 'adopt':
      return adopt($, session)
    default:
      return USAGE
  }
}

export async function registerCommand($: EngineInterface): Promise<void> {
  await $.command.register({
    name: 'workflow',
    description: "This repo's workflows; new, continue, next, pause, models, unlock, delete, adopt, all.",
    argumentHint: '[new <title> | continue [slug] | next | pause | models | unlock <file> <reason> | delete [slug] | adopt | all]',
  })
}

export function registerCommands(on: On, runtime: Runtime): void {
  on('command.run', { command: 'workflow' }, async ($, e) => {
    try {
      const now = await $.clock.now()
      if (words(e.args)[0] === 'all') return { text: await all($, now) }
      const context = await loadContext($)
      if (context === undefined) {
        return { text: 'this folder is not in a git repository. Run git init, then /workflow new <title>.' }
      }
      return { text: await dispatch($, { context, now, runtime }, e.args, e.origin) }
    } catch (error) {
      return { text: error instanceof Refusal ? `${error.message}` : `${describe(error)}` }
    }
  })
}
