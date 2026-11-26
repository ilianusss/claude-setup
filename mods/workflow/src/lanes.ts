import type { EngineInterface, On } from 'claude-code'

import { registerAgents } from './agents'
import { askOrUndefined } from './ask'
import { saveStatus } from './build'
import { day, iso } from './clock'
import type { Config } from './config'
import { contextAt, loadContext, readSlices, specsFolder } from './context'
import type { Context } from './context'
import { handOverWhenIdle } from './handover'
import { sha256 } from './hash'
import { NEXT_SLICES } from './labels'
import { removedLines } from './lock'
import type { Lock, LockedFile } from './lock'
import { greenChecks, integrationFix, laneTasks, phasePrompt, sliceSections, spawnLanes, stopPrompt, stuckReason } from './prompts'
import { describe } from './refusal'
import { abortMerge, addWorktree, commitMerge, deleteMergedBranch, isClean, removeWorktree, startMerge, uncommittedFiles } from './repo'
import { confirmLaneAgent, releaseLaneAgent, reserveLaneAgent, runningSlices, takeLaneAgent } from './running'
import type { LaneRef } from './running'
import { doneSlices, isReady, parseSlices, readySlices, tickSlice } from './slices'
import type { Slice } from './slices'
import { MAX_LANES, inPhase, laneOf, withLog } from './state'
import type { Lane, Workflow } from './state'
import { announcePhase, refreshStatus } from './status'
import { buildsInLanes, deleteLaneFiles, laneKey, listWorkflows, readLock, readWorkflow, saveLock, seedKey, updateWorkflow, withWorkflow } from './store'
import { buildTask, integrationTask, parseTask, resolveTask } from './tasks'
import type { Task } from './tasks'

const BUILD_AGENT = 'workflow:build'

type SliceTask = Exclude<Task, { kind: 'integration' }>
type SpawnPlan = { kind: 'pass' } | { kind: 'deny'; reason: string } | { kind: 'go'; prompt: string; cwd?: string; lane?: LaneRef }
type Building = 'lanes' | 'worktree'

const PASS: SpawnPlan = { kind: 'pass' }

function deny(reason: string): SpawnPlan {
  return { kind: 'deny', reason }
}

function quoted(prompts: readonly string[]): string {
  return prompts.map(prompt => `"${prompt}"`).join(', ')
}

function instead(workflow: Workflow, building: Building, slices: readonly Slice[], running: readonly number[]): string {
  if (building === 'worktree') return `Spawn it with the prompt "${buildTask(workflow.slug, workflow.slice)}": slice ${workflow.slice} builds in the workflow's worktree.`
  const tasks = laneTasks(workflow, slices, running)
  if (tasks.length > 0) return `Spawn instead, each with exactly this prompt: ${quoted(tasks)}.`
  return workflow.lanes.length > 0 ? 'No slice can start now: wait for the running lanes, the mod reports each as it ends.' : stuckReason(slices)
}

function setupLine(config: Config | undefined): string[] {
  return config?.worktreeSetup === undefined
    ? []
    : [`Run \`${config.worktreeSetup}\` first, in your folder, before anything else: the worktree is a fresh checkout.`]
}

function laneSection(context: Context, workflow: Workflow, lane: Lane, existed: boolean): string {
  return [
    '## Your lane',
    '',
    [
      `You build slice ${lane.slice} in your own git worktree \`${lane.worktree}\`, on the branch \`${lane.branch}\` made from \`${workflow.branch}\`. Work only in that folder: the mod refuses a write anywhere else, the workflow's worktree and other lanes included.`,
      ...setupLine(context.config),
      ...(existed
        ? ['The lane exists from an earlier run: read what is there first (`git status`, `git log`, the tests and the code) and go on from where it stopped.']
        : []),
      `Once mcp__workflow__verify passes, commit the slice on \`${lane.branch}\`. Never tick \`slices.md\`: the mod ticks it when it merges your branch.`,
    ].join(' '),
  ].join('\n')
}

function resolveSection(context: Context, workflow: Workflow, lane: Lane): string {
  return [
    '## Resolving the merge',
    '',
    `The mod could not merge \`${lane.branch}\` into \`${workflow.branch}\`, and aborted that merge. In your folder:`,
    '',
    `1. Run \`git merge ${workflow.branch}\` to bring the workflow branch into yours.`,
    "2. Resolve every conflict keeping every slice's tests: during this merge a locked test may take only what git merges cleanly, any other change to it is restored, and only the user unlocks one. A locked test git merged differently from `git merge-file` is restored too: put it to the user then. When git conflicts inside a locked test, stop and put the conflict in your open questions.",
    `3. Run the green checks exactly as written: ${greenChecks(context.config)}.`,
    `4. Commit the merge on \`${lane.branch}\`, then call mcp__workflow__verify: it checks the locked tests and the checks again on the merged code.`,
  ].join('\n')
}

function notReady(slice: Slice, done: ReadonlySet<number>): string {
  if (!slice.declaresDependencies) return `slice ${slice.number} has no Depends on line in slices.md, so the mod cannot tell when it is ready: fix slices.md first.`
  if (slice.unreadDependencies.length > 0) return `slice ${slice.number} depends on "${slice.unreadDependencies.join('", "')}", which the mod cannot read: fix slices.md first.`
  return `slice ${slice.number} waits for slice ${slice.dependsOn.filter(dependency => !done.has(dependency)).join(', ')}, not done yet.`
}

type Reservation = { outcome: 'reserved' | 'taken' | 'full'; lanes: number[] }

// Spawns sent in one message run at the same time: the lane is reserved on the state the last update saved, so two
// spawns never take one slice or more lanes than the limit, and released when git cannot create it.
async function reserveLane($: EngineInterface, context: Context, workflow: Workflow, lane: Lane): Promise<Reservation> {
  const reservation: Reservation = { outcome: 'reserved', lanes: [] }
  await updateWorkflow($, context.paths, workflow.slug, current => {
    reservation.lanes = current.lanes.map(candidate => candidate.slice)
    if (current.lanes.some(candidate => candidate.slice === lane.slice)) reservation.outcome = 'taken'
    else if (current.lanes.length >= MAX_LANES) reservation.outcome = 'full'
    return reservation.outcome === 'reserved' ? { ...current, lanes: [...current.lanes, lane] } : current
  })
  return reservation
}

async function openLane($: EngineInterface, context: Context, workflow: Workflow, slice: Slice, explain: string, slices: readonly Slice[]): Promise<Lane | string> {
  const done = doneSlices(slices)
  if (!isReady(slice, done)) return `${notReady(slice, done)} ${explain}`
  const lane = laneOf(workflow, slice.number)
  if (!lane.worktree.startsWith('/') || lane.branch.startsWith('-')) return `the lane of slice ${slice.number} has a branch or a folder the mod does not pass to git.`
  if (await $.fs.exists(lane.worktree)) {
    return `the folder ${lane.worktree} exists and is not the lane of slice ${slice.number}: ask the user to move it, then spawn again.`
  }
  const reservation = await reserveLane($, context, workflow, lane)
  if (reservation.outcome === 'taken') return `slice ${slice.number} builds already: another spawn took its lane.`
  if (reservation.outcome === 'full') {
    return `${MAX_LANES} lanes run already (slices ${reservation.lanes.join(', ')}): wait for one to end, the mod reports each as it ends.`
  }
  try {
    await addWorktree($, context.repo, lane.branch, lane.worktree, workflow.branch)
    const seed = await readLock($, context.paths, workflow.slug)
    if (seed !== undefined) await saveLock($, context.paths, seedKey(workflow.slug, lane.slice), seed)
  } catch (error) {
    await updateWorkflow($, context.paths, workflow.slug, current => ({
      ...current,
      lanes: current.lanes.filter(candidate => candidate.slice !== lane.slice),
    }))
    throw error
  }
  return lane
}

async function laneFor($: EngineInterface, context: Context, workflow: Workflow, task: SliceTask, slice: Slice, explain: string, slices: readonly Slice[], prompt: string): Promise<SpawnPlan> {
  const existing = workflow.lanes.find(lane => lane.slice === slice.number)
  if (existing === undefined && task.kind === 'resolve') return deny(`slice ${slice.number} has no lane, so no merge to resolve. ${explain}`)
  if (existing !== undefined && !(await $.fs.exists(existing.worktree))) {
    return deny(`the worktree ${existing.worktree} of slice ${slice.number} is gone: ask the user how to go on.`)
  }
  const lane = existing ?? (await openLane($, context, workflow, slice, explain, slices))
  if (typeof lane === 'string') return deny(lane)
  const parts = [
    prompt,
    laneSection(context, workflow, lane, existing !== undefined),
    ...(task.kind === 'resolve' ? [resolveSection(context, workflow, lane)] : []),
    await sliceSections($, context, workflow, slice.number),
  ]
  return { kind: 'go', prompt: parts.join('\n\n'), cwd: lane.worktree, lane: { slug: workflow.slug, slice: slice.number } }
}

// The lane's agent slot is reserved before anything else, so two spawns of one slice in one message start one agent;
// the hook confirms it once the agent started, and every refusal gives it back.
async function planLane($: EngineInterface, context: Context, workflow: Workflow, task: SliceTask, prompt: string): Promise<SpawnPlan> {
  const slices = await readSlices($, context, workflow)
  const running = await runningSlices($, workflow.slug)
  const explain = instead(workflow, 'lanes', slices, running)
  const slice = slices.find(candidate => candidate.number === task.slice)
  if (slice === undefined) return deny(`slices.md has no slice ${task.slice}. ${explain}`)
  if (slice.done) return deny(`slice ${slice.number} is done. ${explain}`)
  const ref = { slug: workflow.slug, slice: slice.number }
  if (!(await reserveLaneAgent($, ref))) return deny(`slice ${slice.number} builds already: its agent runs in its lane. ${explain}`)
  try {
    const plan = await laneFor($, context, workflow, task, slice, explain, slices, prompt)
    if (plan.kind !== 'go') await releaseLaneAgent($, ref)
    return plan
  } catch (error) {
    await releaseLaneAgent($, ref)
    throw error
  }
}

async function planInWorktree($: EngineInterface, context: Context, workflow: Workflow, task: SliceTask, prompt: string): Promise<SpawnPlan> {
  const slices = await readSlices($, context, workflow)
  const explain = instead(workflow, 'worktree', slices, [])
  if (task.kind === 'resolve') return deny(`"${workflow.slug}" has no lane to merge. ${explain}`)
  if (task.slice !== workflow.slice) return deny(`"${workflow.slug}" builds one slice at a time here, and slice ${workflow.slice} is the current one. ${explain}`)
  return { kind: 'go', prompt: `${prompt}\n\n${await sliceSections($, context, workflow, task.slice)}` }
}

async function planSpawn($: EngineInterface, prompt: string): Promise<SpawnPlan> {
  const context = await loadContext($)
  const workflow = context?.current
  if (context === undefined || workflow === undefined || context.lane !== undefined) return PASS
  if (workflow.phase !== 'build' && workflow.phase !== 'inspect') return PASS
  const task = parseTask(prompt, workflow.slug)
  if (task?.kind === 'integration') return { kind: 'go', prompt: `${prompt}\n\n${integrationFix(context.config)}` }
  if (workflow.phase !== 'build') return PASS
  const building: Building = (await buildsInLanes($, context.paths, workflow)) ? 'lanes' : 'worktree'
  if (task === undefined) {
    const slices = await readSlices($, context, workflow)
    return deny(`name the slice in the prompt exactly as the mod writes it. ${instead(workflow, building, slices, await runningSlices($, workflow.slug))}`)
  }
  try {
    return building === 'lanes' ? await planLane($, context, workflow, task, prompt) : await planInWorktree($, context, workflow, task, prompt)
  } catch (error) {
    return deny(`the lane of slice ${task.slice} could not be made ready: ${describe(error)}`)
  }
}

const HEADER_LENGTH = 72
const ELLIPSIS = '...'

// The commit header convention of following-git-conventions: a keyword, an imperative summary, 72 characters at most.
export function mergeMessage(slice: number, name: string): string {
  const head = `feat: merge slice ${slice} (`
  const room = HEADER_LENGTH - head.length - 1
  const shown = name.length <= room ? name : `${name.slice(0, room - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`
  return `${head}${shown})`
}

type LaneEnd =
  | { kind: 'merged'; lane: Lane; name: string; leftovers: string[] }
  | { kind: 'conflict' | 'unready'; lane: Lane; reason: string }
  | { kind: 'waiting'; lane: Lane; files: string[] }

async function snapshotOf($: EngineInterface, path: string): Promise<LockedFile | undefined> {
  try {
    const content = await $.fs.read(path)
    return { hash: await sha256(content), content }
  } catch {
    return undefined
  }
}

// The lane's tests join the workflow lock as the merge left them, so the next lane's lock refuses their removed lines,
// and so do the tests the user unlocked, in the lane or in the workflow's worktree: their new content is locked again.
async function mergedLock($: EngineInterface, workflow: Workflow, own: Lock | undefined, lane: Lock, now: number): Promise<Lock> {
  const files: Record<string, LockedFile> = { ...own?.files }
  for (const file of new Set([...Object.keys(lane.files), ...(own?.unlocked ?? [])])) {
    const merged = await snapshotOf($, `${workflow.worktree}/${file}`)
    if (merged === undefined) delete files[file]
    else files[file] = merged
  }
  return { slug: workflow.slug, slice: lane.slice, phase: 'open', files, sliceFiles: lane.sliceFiles, unlocked: [], updated: iso(now) }
}

// A merge that keeps a test file but drops a line a slice locked in it would pass every check: it is never committed.
// A test the user unlocked, in the lane or in the workflow's worktree, may change.
async function lostLines($: EngineInterface, workflow: Workflow, locks: ReadonlyArray<Lock | undefined>): Promise<string[]> {
  const unlocked = new Set(locks.flatMap(lock => lock?.unlocked ?? []))
  const lost: string[] = []
  for (const lock of locks) {
    for (const [file, locked] of Object.entries(lock?.files ?? {})) {
      if (unlocked.has(file)) continue
      const merged = (await snapshotOf($, `${workflow.worktree}/${file}`))?.content ?? ''
      lost.push(...removedLines(locked.content, merged).map(line => `${file}: \`${line}\``))
    }
  }
  return [...new Set(lost)]
}

async function keepLane($: EngineInterface, context: Context, workflow: Workflow, lane: Lane, kind: 'conflict' | 'unready', reason: string, now: number): Promise<LaneEnd> {
  await updateWorkflow($, context.paths, workflow.slug, current =>
    withLog(
      { ...current, lanes: current.lanes.map(candidate => (candidate.slice === lane.slice ? { ...candidate, verified: false } : candidate)), updated: iso(now) },
      day(now),
      `slice ${lane.slice} not merged: ${kind === 'conflict' ? 'the merge failed' : 'uncommitted changes'}`,
    ),
  )
  return { kind, lane, reason }
}

async function cleanUp($: EngineInterface, workflow: Workflow, lane: Lane): Promise<string[]> {
  const removed = await removeWorktree($, workflow.worktree, lane.worktree)
  if (removed !== undefined) return [removed]
  const deleted = await deleteMergedBranch($, workflow.worktree, lane.branch)
  return deleted === undefined ? [] : [deleted]
}

type Committed = { name: string; own: Lock | undefined; isBuilt: boolean }

// Runs with the merge started: slices.md and the workflow lock are read here, after any earlier merge saved them.
async function commitLane($: EngineInterface, context: Context, workflow: Workflow, lane: Lane, laneLock: Lock | undefined): Promise<Committed | string> {
  try {
    const slicesFile = `${workflow.worktree}/${specsFolder(context, workflow)}/slices.md`
    const markdown = await $.fs.read(slicesFile)
    const slice = parseSlices(markdown).find(candidate => candidate.number === lane.slice)
    const ticked = tickSlice(markdown, lane.slice)
    if (slice === undefined || ticked === undefined) return `slices.md has no open Done line for slice ${lane.slice}`
    const own = await readLock($, context.paths, workflow.slug)
    const lost = await lostLines($, workflow, [own, laneLock])
    if (lost.length > 0) {
      return `the merge would drop these lines of locked tests: ${lost.join('; ')}. Merge keeping every slice's lines`
    }
    await $.fs.write(slicesFile, ticked)
    const failed = await commitMerge($, workflow.worktree, `${specsFolder(context, workflow)}/slices.md`, mergeMessage(lane.slice, slice.name))
    if (failed !== undefined) return failed
    return { name: slice.name, own, isBuilt: parseSlices(ticked).every(candidate => candidate.done) }
  } catch (error) {
    return describe(error)
  }
}

// The merge runs in the workflow's worktree, which has to be clean: an aborted merge cannot always give back changes
// that were uncommitted when it started. When it is not, the lane stays verified and waits for a later merge.
async function mergeVerified($: EngineInterface, context: Context, workflow: Workflow, lane: Lane, now: number): Promise<LaneEnd> {
  const feature = workflow.worktree
  if (!feature.startsWith('/') || lane.branch.startsWith('-')) {
    return keepLane($, context, workflow, lane, 'conflict', 'the state names a worktree or a branch the mod does not pass to git', now)
  }
  if (!(await isClean($, lane.worktree))) return keepLane($, context, workflow, lane, 'unready', `its lane ${lane.worktree} has uncommitted changes`, now)
  const dirty = await uncommittedFiles($, feature)
  if (dirty.length > 0) return { kind: 'waiting', lane, files: dirty }
  const laneLock = await readLock($, context.paths, laneKey(workflow.slug, lane.slice))

  const failed = await startMerge($, feature, lane.branch)
  if (failed !== undefined) return keepLane($, context, workflow, lane, 'conflict', failed, now)
  const committed = await commitLane($, context, workflow, lane, laneLock)
  if (typeof committed === 'string') {
    await abortMerge($, feature)
    return keepLane($, context, workflow, lane, 'conflict', committed, now)
  }

  if (laneLock !== undefined) await saveLock($, context.paths, workflow.slug, await mergedLock($, workflow, committed.own, laneLock, now))
  await deleteLaneFiles($, context.paths, workflow.slug, lane.slice)
  const leftovers = await cleanUp($, workflow, lane)
  await updateWorkflow($, context.paths, workflow.slug, current => {
    const lanes = current.lanes.filter(candidate => candidate.slice !== lane.slice)
    const next = committed.isBuilt && lanes.length === 0 ? inPhase(current, 'inspect') : current
    return withLog({ ...next, lanes, updated: iso(now) }, day(now), `slice ${lane.slice} merged`)
  })
  return { kind: 'merged', lane, name: committed.name, leftovers }
}

// Two lanes ending together would each read slices.md and the lock before the other saved them, and a failed merge's
// abort would end the other's: the merges of a workflow run one at a time, each on the state the last one left.
async function mergeLane($: EngineInterface, context: Context, slug: string, slice: number, now: number): Promise<LaneEnd | undefined> {
  return withWorkflow(context.paths, slug, async () => {
    const workflow = await readWorkflow($, context.paths, slug)
    const lane = workflow.lanes.find(candidate => candidate.slice === slice)
    if (lane === undefined || !lane.verified) return undefined
    return mergeVerified($, context, workflow, lane, now)
  })
}

// The lane whose agent ended first, then every verified lane no agent works in, such as one that waited for the
// workflow's worktree to be clean. They stop at the first that still waits.
async function mergeVerifiedLanes($: EngineInterface, context: Context, slug: string, first: number | undefined): Promise<LaneEnd[]> {
  const now = await $.clock.now()
  const ends: LaneEnd[] = []
  const firstEnd = first === undefined ? undefined : await mergeLane($, context, slug, first, now)
  if (firstEnd !== undefined) ends.push(firstEnd)
  if (firstEnd?.kind === 'waiting') return ends
  const running = await runningSlices($, slug)
  const waiting = (await readWorkflow($, context.paths, slug)).lanes.filter(lane => lane.verified && lane.slice !== first && !running.includes(lane.slice))
  for (const lane of waiting) {
    const end = await mergeLane($, context, slug, lane.slice, now)
    if (end === undefined) continue
    ends.push(end)
    if (end.kind === 'waiting') break
  }
  return ends
}

function headline(end: LaneEnd, workflow: Workflow): string {
  const { lane } = end
  if (end.kind === 'merged') {
    const leftovers =
      end.leftovers.length === 0
        ? ''
        : ` It could not clean up the lane: ${end.leftovers.join('; ')}. Tell the user to remove the worktree ${lane.worktree} and the branch ${lane.branch} by hand once they checked them.`
    return `The mod merged \`${lane.branch}\` into \`${workflow.branch}\` and ticked slice ${lane.slice} (${end.name}).${leftovers}`
  }
  if (end.kind === 'conflict') {
    return `The mod could not merge \`${lane.branch}\` into \`${workflow.branch}\`: ${end.reason}. It aborted the merge and kept the lane.`
  }
  if (end.kind === 'waiting') {
    return `The mod has not merged \`${lane.branch}\` yet: the workflow's worktree \`${workflow.worktree}\` has uncommitted changes (${end.files.join(', ')}). Show them to the user and have them committed, never discarded: the mod merges the lane at the next lane end or at \`/workflow continue\`.`
  }
  return `The mod did not merge \`${lane.branch}\`: ${end.reason}.`
}

function integrationChecks(context: Context, workflow: Workflow): string {
  return `First run the green checks here, in the workflow's worktree \`${workflow.worktree}\`, exactly as written: ${greenChecks(context.config)}. When one fails, spawn \`workflow:build\` in the foreground with the prompt "${integrationTask(workflow.slug)}" followed by each failing command and its output, wait for its report and relay it, before anything below.`
}

async function startsChosen($: EngineInterface, workflow: Workflow, ready: readonly number[]): Promise<number[] | 'stopped'> {
  if (ready.length === 0 || workflow.autoNext || !workflow.technical) return [...ready]
  const answer = await askOrUndefined($, NEXT_SLICES.question(workflow.slug, ready), [NEXT_SLICES.start, NEXT_SLICES.stop], 'Next slices')
  return answer === NEXT_SLICES.start ? [...ready] : 'stopped'
}

function againTask(slug: string, end: LaneEnd): string[] {
  if (end.kind === 'conflict') return [resolveTask(slug, end.lane.slice)]
  return end.kind === 'unready' ? [buildTask(slug, end.lane.slice)] : []
}

function slicesWord(slices: readonly number[]): string {
  return slices.length === 1 ? `Slice ${slices.join('')}` : `Slices ${slices.join(', ')}`
}

async function afterLanes($: EngineInterface, context: Context, slug: string, ends: readonly LaneEnd[], ended: number | undefined): Promise<string> {
  const workflow = await readWorkflow($, context.paths, slug)
  const heads = [...(ended === undefined ? [] : [`The \`workflow:build\` agent of slice ${ended} has ended.`]), ...ends.map(end => headline(end, workflow))]
  const isMerged = ends.some(end => end.kind === 'merged')
  if (workflow.phase === 'inspect') {
    await saveStatus($, context, workflow, 'active')
    return [
      ...heads,
      integrationChecks(context, workflow),
      `The build is done: "${workflow.slug}" is now in its inspect phase. Then go straight on with it in this conversation:\n\n${await phasePrompt($, context, workflow)}`,
    ].join('\n\n')
  }
  const again = ends.flatMap(end => againTask(workflow.slug, end))
  const againSlices = ends.filter(end => end.kind === 'conflict' || end.kind === 'unready').map(end => end.lane.slice)
  const slices = await readSlices($, context, workflow)
  const free = Math.max(MAX_LANES - workflow.lanes.length, 0)
  const ready = readySlices(slices, workflow.lanes.map(lane => lane.slice), free).map(slice => slice.number)
  const starts = await startsChosen($, workflow, ready)
  const tasks = [...again, ...(starts === 'stopped' ? [] : starts.map(slice => buildTask(workflow.slug, slice)))]
  const building = workflow.lanes.filter(lane => !lane.verified && !againSlices.includes(lane.slice)).map(lane => lane.slice)
  const waiting = workflow.lanes.filter(lane => lane.verified).map(lane => lane.slice)
  const parts = [...heads, ...(isMerged ? [integrationChecks(context, workflow)] : [])]
  if (tasks.length > 0) {
    await saveStatus($, context, workflow, 'active')
    parts.push(spawnLanes(workflow, tasks))
  }
  if (building.length > 0) parts.push(`${slicesWord(building)} still build in their lanes: the mod reports each as it ends.`)
  if (waiting.length > 0) parts.push(`${slicesWord(waiting)} ${waiting.length === 1 ? 'waits' : 'wait'} for the mod to merge ${waiting.length === 1 ? 'it' : 'them'}.`)
  if (tasks.length === 0 && building.length === 0 && waiting.length === 0) {
    if (starts !== 'stopped') return [...parts, stuckReason(slices)].join('\n\n')
    await saveStatus($, context, workflow, 'paused')
    parts.push(`The user starts no new slice now. ${stopPrompt(workflow)}`)
    return parts.join('\n\n')
  }
  if (starts === 'stopped') parts.push('The user starts no new slice for now: the mod asks again when the next lane ends.')
  if (tasks.length === 0) parts.push('End your turn after the relay, telling the user that the mod reports each lane as it ends.')
  return parts.join('\n\n')
}

// The hook may run in the lane's folder, gone once merged: the band is drawn from the workflow's worktree instead.
async function refreshAfterMerge($: EngineInterface, context: Context, slug: string): Promise<void> {
  const workflows = await listWorkflows($, context.paths)
  const current = workflows.find(candidate => candidate.slug === slug)
  const fresh = { ...context, workflows, current, lane: undefined }
  await refreshStatus($, fresh)
  if (current?.phase === 'inspect') {
    announcePhase($, current)
    await registerAgents($, fresh)
  }
}

async function laneEnded($: EngineInterface, ended: LaneRef): Promise<void> {
  const session = await loadContext($)
  const workflow = session?.workflows.find(candidate => candidate.slug === ended.slug)
  if (session === undefined || workflow === undefined) return
  if ((await runningSlices($, ended.slug)).includes(ended.slice)) return
  const context = (await contextAt($, workflow.worktree)) ?? session
  const ends = await mergeVerifiedLanes($, context, workflow.slug, ended.slice)
  if (ends.length === 0) return
  await handOverWhenIdle($, await afterLanes($, context, workflow.slug, ends, ended.slice))
  await refreshAfterMerge($, context, workflow.slug)
}

// `/workflow continue` retries the merges that waited, before the phase prompt: their outcome, or nothing.
export async function mergeWaitingLanes($: EngineInterface, context: Context, workflow: Workflow): Promise<string | undefined> {
  if (workflow.phase !== 'build' || !workflow.lanes.some(lane => lane.verified)) return undefined
  const here = (await contextAt($, workflow.worktree)) ?? context
  const ends = await mergeVerifiedLanes($, here, workflow.slug, undefined)
  if (ends.length === 0) return undefined
  await refreshAfterMerge($, here, workflow.slug)
  const fresh = await readWorkflow($, here.paths, workflow.slug)
  const heads = ends.map(end => headline(end, fresh))
  return [...heads, ...(ends.some(end => end.kind === 'merged') ? [integrationChecks(here, fresh)] : [])].join('\n\n')
}

// A lane whose merge failed half way would otherwise wait in silence: the conversation hears of it.
export async function endLane($: EngineInterface, agentId: string): Promise<void> {
  let ended: LaneRef | undefined
  try {
    ended = await takeLaneAgent($, agentId)
    if (ended !== undefined) await laneEnded($, ended)
  } catch (error) {
    $.ui.log(`workflow: the lane of a workflow:build agent could not be merged: ${describe(error)}`, { to: 'debug' })
    if (ended === undefined) return
    const failure = `The mod could not merge the lane of slice ${ended.slice} of \`${ended.slug}\`: ${describe(error)}. Tell the user, and ask how to go on.`
    await handOverWhenIdle($, failure).catch(handover => {
      $.ui.log(`workflow: the failed merge could not be handed to the conversation: ${describe(handover)}`, { to: 'debug' })
    })
  }
}

// Only the main loop spawns slices: a subagent's own spawns are left alone.
export function registerLanes(on: On): void {
  on('agent.spawn', { subagentType: BUILD_AGENT }, async ($, e, next) => {
    if (e.parentAgentId !== undefined) return next(e)
    const plan = await planSpawn($, e.prompt)
    if (plan.kind === 'pass') return next(e)
    if (plan.kind === 'deny') return { deny: `workflow: ${plan.reason}` }
    const { lane } = plan
    let started: Awaited<ReturnType<typeof next>>
    try {
      started = await next({ ...e, prompt: plan.prompt, ...(plan.cwd === undefined ? {} : { cwd: plan.cwd }) })
    } catch (error) {
      if (lane !== undefined) await releaseLaneAgent($, lane)
      throw error
    }
    if (lane !== undefined) {
      if (started.agentId === undefined) await releaseLaneAgent($, lane)
      else await confirmLaneAgent($, lane, started.agentId)
    }
    return started
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'workflow: the guard on spawning workflow:build failed, so the spawn is refused.' }))
}
