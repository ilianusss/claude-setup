import type { EngineInterface, ToolCallResult } from 'claude-code'

import { askOrUndefined } from './ask'
import { checksFor, isWatched, testFilesCommands } from './checks'
import { day, iso } from './clock'
import type { Config } from './config'
import { readSlices, specsFolder } from './context'
import type { Context } from './context'
import { matchesAny } from './glob'
import { sha256 } from './hash'
import { NEXT_SLICE, UNLOCK } from './labels'
import { latestRun, removedLines } from './lock'
import type { Lock, LockedFile } from './lock'
import { endWithContinue, fillContinue, laneTasks, phasePrompt, spawnBuild, spawnLanes, stopPrompt } from './prompts'
import { refuse } from './refusal'
import { changedFiles, isMergingIn, mergeFile, relativeTo, treeHash } from './repo'
import { runningSlices } from './running'
import { addRun, buildsInLanes, laneKey, mergeFolderOf, readLock, readRuns, saveLock, seedKey, treeIndexOf, updateWorkflow } from './store'
import { inPhase, withLog } from './state'
import type { Lane, Workflow } from './state'

const EXIT_CODE = /^Exit code (\d+)/

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function inBuild(context: Context): Workflow {
  const workflow = context.current
  if (workflow === undefined) refuse('no workflow runs on this branch. /workflow continue <slug> picks one.')
  if (workflow.phase !== 'build') {
    refuse(`the workflow "${workflow.slug}" is in its ${workflow.phase} phase: tests are locked and verified in the build phase only.`)
  }
  return workflow
}

type SliceFiles = { key: string; index: string }

// A lane has its own lock, runs and tree index; the workflow's worktree keeps the workflow's.
function filesOf(context: Context, workflow: Workflow): SliceFiles {
  if (context.lane === undefined) return { key: workflow.slug, index: treeIndexOf(context.paths, undefined) }
  const key = laneKey(workflow.slug, context.lane.slice)
  return { key, index: treeIndexOf(context.paths, key) }
}

type Building = SliceFiles & { workflow: Workflow; lane: Lane | undefined; slice: number }

async function building($: EngineInterface, context: Context): Promise<Building> {
  const workflow = inBuild(context)
  const lane = context.lane
  if (lane === undefined && (await buildsInLanes($, context.paths, workflow))) {
    refuse(
      `"${workflow.slug}" builds its slices in lanes, each in its own worktree: mcp__workflow__lock and mcp__workflow__verify run in a lane. A fix in the workflow's worktree runs without them.`,
    )
  }
  return { workflow, lane, slice: lane?.slice ?? workflow.slice, ...filesOf(context, workflow) }
}

function configOf(context: Context): Config {
  if (context.config !== undefined) return context.config
  if (context.configErrors.length > 0) refuse(`.claude/workflow.json has problems: ${context.configErrors.join('; ')}.`)
  refuse('this project has no .claude/workflow.json. /workflow adopt sets it up.')
}

function testGlobs(config: Config): string[] {
  return [...config.testGlobs, ...config.packages.flatMap(entry => entry.testGlobs)]
}

async function readText($: EngineInterface, root: string, file: string): Promise<string | undefined> {
  try {
    return await $.fs.read(`${root}/${file}`)
  } catch {
    return undefined
  }
}

async function snapshot(text: string): Promise<LockedFile> {
  return { hash: await sha256(text), content: text }
}

async function changedLockedFiles($: EngineInterface, context: Context, lock: Lock): Promise<string[]> {
  const changed: string[] = []
  for (const [file, locked] of Object.entries(lock.files)) {
    if (lock.unlocked.includes(file)) continue
    const text = await readText($, context.repo.root, file)
    if (text === undefined || (await sha256(text)) !== locked.hash) changed.push(file)
  }
  return changed
}

type Settled = { lock: Lock; changed: string[]; conflicted: string[] }

// A lane that merges the workflow branch in may take, for a test it locked, exactly what git merges cleanly from the
// lane's version, the version the lane started from and the workflow lock's: nothing else, and only during that merge.
async function settledLock($: EngineInterface, context: Context, workflow: Workflow, key: string, lock: Lock): Promise<Settled> {
  const changed = await changedLockedFiles($, context, lock)
  const unsettled = { lock, changed, conflicted: [] }
  if (context.lane === undefined || changed.length === 0 || !(await isMergingIn($, context.repo.root, workflow.branch))) return unsettled
  const merged = await readLock($, context.paths, workflow.slug)
  const files: Record<string, LockedFile> = { ...lock.files }
  const bases: Record<string, string> = { ...lock.bases }
  const left: string[] = []
  const conflicted: string[] = []
  for (const file of changed) {
    const text = await readText($, context.repo.root, file)
    const ours = lock.files[file]
    const theirs = merged?.files[file]
    if (text === undefined || ours === undefined || theirs === undefined) {
      left.push(file)
      continue
    }
    const result = await mergeFile($, mergeFolderOf(context.paths, key), { ours: ours.content, base: lock.bases?.[file] ?? '', theirs: theirs.content })
    if (result.isClean && result.text === text) {
      files[file] = await snapshot(text)
      bases[file] = theirs.content
    } else {
      left.push(file)
      if (!result.isClean) conflicted.push(file)
    }
  }
  if (left.length === changed.length) return { lock, changed, conflicted }
  const kept = { ...lock, files, bases }
  await saveLock($, context.paths, key, kept)
  return { lock: kept, changed: left, conflicted }
}

function restoredNote(file: string, lock: Lock, conflicted: readonly string[]): string {
  if (conflicted.includes(file)) {
    return `workflow: restored ${file}: git conflicts inside this locked test of slice ${lock.slice} while merging the workflow branch. Stop, and put the conflict to the user in your report: only the user unlocks a locked test.`
  }
  return `workflow: restored ${file}: it is a locked test of slice ${lock.slice} and that command changed it. Locked tests stay as written until verify passes; if one is wrong, call mcp__workflow__unlock with the reason.`
}

async function restore($: EngineInterface, context: Context, lock: Lock, files: readonly string[]): Promise<void> {
  for (const file of files) {
    const locked = lock.files[file]
    if (locked !== undefined) await $.fs.write(`${context.repo.root}/${file}`, locked.content)
  }
}

export async function lockSlice($: EngineInterface, context: Context, now: number): Promise<string> {
  const { workflow, lane, slice, key, index } = await building($, context)
  const config = configOf(context)
  const own = await readLock($, context.paths, key)
  if (own?.phase === 'green') {
    refuse(`slice ${own.slice} is locked already: implement until its checks pass, then call mcp__workflow__verify.`)
  }
  // A lane's first lock starts from the tests the merged slices locked, so its lock refuses their removed lines too.
  // A lane's first lock starts from the workflow lock as it stood when the lane was made: a test merged since is not in
  // its worktree, and reaches it only through the lane's merge of the workflow branch.
  const seed = own === undefined && lane !== undefined ? await readLock($, context.paths, seedKey(workflow.slug, lane.slice)) : undefined
  const lock = own ?? seed

  const globs = testGlobs(config)
  const known = lock?.files ?? {}
  const candidates = [...new Set([...(await changedFiles($, context.repo)), ...Object.keys(known)])]
  const testFiles = candidates.filter(file => matchesAny(file, globs)).sort()
  const current = new Map<string, string | undefined>()
  for (const file of testFiles) current.set(file, await readText($, context.repo.root, file))

  const losses = Object.entries(known)
    .filter(([file]) => matchesAny(file, globs) && !(lock?.unlocked ?? []).includes(file))
    .flatMap(([file, locked]) => removedLines(locked.content, current.get(file) ?? '').map(line => `- ${file}: \`${line}\``))
  if (losses.length > 0) {
    refuse(
      [
        'These lines of tests locked in an earlier slice are gone:',
        ...losses,
        '',
        'Adding tests is fine; removing or changing locked lines is not. Restore them, or, if a test is wrong, call mcp__workflow__unlock with the reason: the user decides.',
      ].join('\n'),
    )
  }

  const sliceFiles: string[] = []
  for (const file of testFiles) {
    const text = current.get(file)
    if (text !== undefined && known[file]?.hash !== (await sha256(text))) sliceFiles.push(file)
  }
  if (sliceFiles.length === 0) {
    refuse(`no new or changed test file since the last lock. Write this slice's tests first (test files match ${globs.join(', ')}).`)
  }

  const commands = testFilesCommands(config, sliceFiles)
  const tree = await treeHash($, context.repo, index)
  const runs = await readRuns($, context.paths, key)
  const problems = commands.flatMap(command => {
    const run = latestRun(runs, command)
    if (run === undefined) return [`- \`${command}\` has not run on these tests yet.`]
    if (run.tree !== tree) return [`- The code changed since \`${command}\` last ran.`]
    if (run.exitCode === 0) {
      return [`- \`${command}\` passed: tests are locked once they fail for the right reason. A test that passes on its first run is suspect.`]
    }
    return []
  })
  if (problems.length > 0) {
    refuse(
      [
        ...problems,
        '',
        `Run ${commands.map(command => `\`${command}\``).join(', then ')} exactly as written, with nothing appended, and read every failure: an import, compile or syntax error is a broken test, not a red one. Then call mcp__workflow__lock again.`,
      ].join('\n'),
    )
  }

  const files: Record<string, LockedFile> = { ...known }
  for (const file of sliceFiles) files[file] = await snapshot(current.get(file) ?? '')
  for (const file of config.testConfig) {
    const text = await readText($, context.repo.root, file)
    if (text !== undefined) files[file] = await snapshot(text)
  }
  // A lane carries the unlocks the user approved in the workflow's worktree, and the base of each seeded test.
  const bases = own?.bases ?? (seed === undefined ? undefined : Object.fromEntries(Object.entries(seed.files).map(([file, locked]) => [file, locked.content])))
  await saveLock($, context.paths, key, {
    slug: workflow.slug,
    slice,
    phase: 'green',
    files,
    sliceFiles,
    unlocked: seed?.unlocked ?? [],
    updated: iso(now),
    ...(bases === undefined ? {} : { bases }),
  })
  await updateWorkflow($, context.paths, workflow.slug, current =>
    withLog({ ...current, updated: iso(now) }, day(now), `slice ${slice} tests locked: ${sliceFiles.join(', ')}`),
  )
  return [
    `Locked ${plural(sliceFiles.length, 'test file')} for slice ${slice}: ${sliceFiles.join(', ')}.`,
    '',
    'They are frozen until verify passes: the mod refuses edits to them and restores any change made through the shell. Implement the code, run each check exactly as written until it passes, then call mcp__workflow__verify:',
    ...checksFor(config, sliceFiles).map(command => `- \`${command}\``),
  ].join('\n')
}

export type Verified = { slice: number; closing: string[]; advanced: Workflow }
export type LaneVerified = { slice: number; lane: Lane; workflow: Workflow }

export async function verifySlice(
  $: EngineInterface,
  context: Context,
  now: number,
): Promise<{ kind: 'slice'; verified: Verified } | { kind: 'lane'; verified: LaneVerified }> {
  const { workflow, lane, slice, key, index } = await building($, context)
  const config = configOf(context)
  const found = await readLock($, context.paths, key)
  if (found === undefined || found.phase !== 'green') {
    refuse(`nothing is locked for slice ${slice}: write its tests, see them fail, and call mcp__workflow__lock first.`)
  }

  const { lock, changed: tampered, conflicted } = await settledLock($, context, workflow, key, found)
  if (tampered.length > 0) {
    await restore($, context, lock, tampered)
    const stop = conflicted.length > 0 ? ` git conflicts inside ${conflicted.join(', ')}: stop, and put the conflict to the user in your report.` : ''
    refuse(`these locked tests had changed and were restored: ${tampered.join(', ')}. Run the checks again on the restored tests.${stop}`)
  }

  const checks = checksFor(config, lock.sliceFiles)
  const tree = await treeHash($, context.repo, index)
  const runs = await readRuns($, context.paths, key)
  const missing = checks.filter(command => {
    const run = latestRun(runs, command)
    return run === undefined || run.tree !== tree || run.exitCode !== 0
  })
  if (missing.length > 0) {
    refuse(
      [
        `Slice ${slice} is not done yet. Run each of these exactly as written, on the current code, until it passes, then call mcp__workflow__verify again:`,
        ...missing.map(command => `- \`${command}\``),
      ].join('\n'),
    )
  }

  // A lane's lock stays green until the merge: a conflict resolved in the lane is verified again on the locked tests.
  if (lane !== undefined) {
    const saved = await updateWorkflow($, context.paths, workflow.slug, current =>
      withLog(
        { ...current, lanes: current.lanes.map(candidate => (candidate.slice === slice ? { ...candidate, verified: true } : candidate)), updated: iso(now) },
        day(now),
        `slice ${slice} verified in its lane`,
      ),
    )
    return { kind: 'lane', verified: { slice, lane, workflow: saved } }
  }

  const files: Record<string, LockedFile> = { ...lock.files }
  for (const file of lock.unlocked) {
    const text = await readText($, context.repo.root, file)
    if (text === undefined) delete files[file]
    else files[file] = await snapshot(text)
  }
  await saveLock($, context.paths, key, { ...lock, files, phase: 'open', unlocked: [], updated: iso(now) })

  const slices = await readSlices($, context, workflow)
  const isLast = !slices.some(candidate => candidate.number > slice)
  const advanced = await updateWorkflow($, context.paths, workflow.slug, current =>
    withLog({ ...(isLast ? inPhase(current, 'inspect') : { ...current, slice: slice + 1 }), updated: iso(now) }, day(now), `slice ${slice} verified`),
  )

  const closing = [
    `1. Tick slice ${workflow.slice} in \`${specsFolder(context, workflow)}/slices.md\`.`,
    workflow.commits
      ? '2. Commit the slice, following the following-git-conventions skill.'
      : '2. Do not commit: in this workflow the user commits.',
  ]
  return { kind: 'slice', verified: { slice, closing, advanced } }
}

function startedBy(advanced: Workflow): string {
  return advanced.phase === 'inspect' ? 'start the inspect phase' : `start slice ${advanced.slice}`
}

export async function verifiedForConversation($: EngineInterface, context: Context, verified: Verified): Promise<string> {
  const next = await nextStep($, context, verified.advanced)
  const goesOn = next.kind === 'go' ? `Do the steps above first. ${endWithContinue(startedBy(verified.advanced), await fillContinue($))}` : next.text
  return [
    `Slice ${verified.slice} verified.`,
    '',
    ...verified.closing,
    '',
    '## Next',
    '',
    goesOn,
  ].join('\n')
}

export function verifiedInLane(verified: LaneVerified, context: Context): string {
  return [
    `Slice ${verified.slice} verified in its lane: finish your report. Before it:`,
    '',
    `1. Commit the slice on the branch \`${verified.lane.branch}\`, following the following-git-conventions skill: everything it changed, so \`git status\` is clean.`,
    `2. Do not tick slice ${verified.slice} in \`${specsFolder(context, verified.workflow)}/slices.md\`: the mod ticks it when it merges your branch.`,
    '',
    `Once your run ends, the mod merges \`${verified.lane.branch}\` into \`${verified.workflow.branch}\` and hands the next step to the conversation. The next slice is not yours.`,
  ].join('\n')
}

export function verifiedForAgent(verified: Verified): string {
  return [
    `Slice ${verified.slice} verified: finish your report. Before it:`,
    '',
    ...verified.closing,
    '',
    'The next slice is not yours: the mod hands the next step to the conversation once your run ends.',
  ].join('\n')
}

export async function saveStatus($: EngineInterface, context: Context, workflow: Workflow, status: 'active' | 'paused'): Promise<void> {
  if (workflow.status === status) return
  const now = await $.clock.now()
  await updateWorkflow($, context.paths, workflow.slug, current =>
    withLog({ ...current, status, updated: iso(now) }, day(now), status === 'active' ? 'resumed' : 'paused'),
  )
}

export type NextStep = { kind: 'go' | 'stop'; text: string }

// A workflow that commits finished a slice it had locked before lanes existed: the next slices start in lanes.
async function nextSpawn($: EngineInterface, context: Context, advanced: Workflow): Promise<string> {
  if (!advanced.commits) return spawnBuild(advanced)
  const tasks = laneTasks(advanced, await readSlices($, context, advanced), await runningSlices($, advanced.slug))
  return tasks.length > 0 ? spawnLanes(advanced, tasks) : 'No slice can start now: wait for the running lanes, the mod reports each as it ends.'
}

export async function nextStep($: EngineInterface, context: Context, advanced: Workflow): Promise<NextStep> {
  if (advanced.phase === 'inspect') {
    await saveStatus($, context, advanced, 'active')
    return {
      kind: 'go',
      text: `The build is done: "${advanced.slug}" is now in its inspect phase. Go straight on with it in this conversation:\n\n${await phasePrompt($, context, advanced)}`,
    }
  }
  const spawn = await nextSpawn($, context, advanced)
  if (advanced.autoNext || !advanced.technical) {
    await saveStatus($, context, advanced, 'active')
    return { kind: 'go', text: `Call mcp__workflow__handoff with where things stand, then go straight on with slice ${advanced.slice}. ${spawn}` }
  }
  const answer = await askOrUndefined($, NEXT_SLICE.question(advanced.slug, advanced.slice - 1), [NEXT_SLICE.start(advanced.slice), NEXT_SLICE.stop], 'Next slice')
  if (answer === NEXT_SLICE.start(advanced.slice)) {
    await saveStatus($, context, advanced, 'active')
    return { kind: 'go', text: `The user starts slice ${advanced.slice} now. Call mcp__workflow__handoff with where things stand, then: ${spawn}` }
  }
  await saveStatus($, context, advanced, 'paused')
  return { kind: 'stop', text: `The user stops here; slice ${advanced.slice} is next. ${stopPrompt(advanced)}` }
}

type Held = { key: string; lock: Lock; file: string }

// The conversation unlocks from the workflow's worktree: a test a lane locked is in that lane's lock.
async function lockHolding($: EngineInterface, context: Context, workflow: Workflow, given: string): Promise<Held> {
  const { slug } = workflow
  const places =
    context.lane === undefined
      ? [...workflow.lanes.map(lane => ({ key: laneKey(slug, lane.slice), root: lane.worktree })), { key: slug, root: context.repo.root }]
      : [{ key: laneKey(slug, context.lane.slice), root: context.repo.root }]
  const locked: string[] = []
  for (const place of places) {
    const lock = await readLock($, context.paths, place.key)
    if (lock === undefined) continue
    const file = given.startsWith('/') ? (relativeTo(place.root, given) ?? given) : given
    if (lock.files[file] !== undefined) return { key: place.key, lock, file }
    locked.push(...Object.keys(lock.files))
  }
  if (locked.length === 0) refuse(`nothing is locked in "${slug}".`)
  const named = given.startsWith('/') ? (relativeTo(context.repo.root, given) ?? given) : given
  refuse(`${named} is not locked. Locked files: ${[...new Set(locked)].join(', ')}.`)
}

export async function unlockFile(
  $: EngineInterface,
  context: Context,
  given: string,
  reason: string,
  byThePerson: boolean,
  now: number,
): Promise<string> {
  const workflow = context.current
  if (workflow === undefined) refuse('no workflow runs on this branch.')
  const { key, lock, file } = await lockHolding($, context, workflow, given)
  if (lock.unlocked.includes(file)) return `${file} is unlocked already.`

  if (!byThePerson) {
    const answer = await askOrUndefined(
      $,
      `Unlock ${file} in the workflow "${workflow.slug}"?\n\nClaude's reason: ${reason}`,
      [UNLOCK.yes, UNLOCK.no],
      'Unlock',
    )
    if (answer !== UNLOCK.yes) {
      return `The user kept ${file} locked${answer === undefined ? '' : ` (${answer})`}. Do not change it: explain the problem to the user instead.`
    }
  }
  await saveLock($, context.paths, key, { ...lock, unlocked: [...lock.unlocked, file], updated: iso(now) })
  await updateWorkflow($, context.paths, workflow.slug, current =>
    withLog({ ...current, updated: iso(now) }, day(now), `unlocked ${file}: ${reason}`),
  )
  return `Unlocked ${file}. You may change it now; say what changed and why in your report.`
}

function exitCodeOf(ran: ToolCallResult<'Bash'>): number | undefined {
  if (ran.deny !== undefined) return undefined
  if (ran.isError === true) {
    const match = EXIT_CODE.exec(ran.text ?? '')
    return match === null ? undefined : Number(match[1])
  }
  const record = ran.result as { interrupted?: boolean; backgroundTaskId?: string } | undefined
  return record?.interrupted === true || record?.backgroundTaskId !== undefined ? undefined : 0
}

export async function afterShell(
  $: EngineInterface,
  context: Context,
  command: string,
  ran: ToolCallResult<'Bash'>,
  now: number,
): Promise<string[]> {
  const workflow = context.current
  if (workflow === undefined) return []
  const { key, index } = filesOf(context, workflow)
  const found = await readLock($, context.paths, key)
  if (found?.phase === 'green') {
    const { lock, changed, conflicted } = await settledLock($, context, workflow, key, found)
    if (changed.length > 0) {
      await restore($, context, lock, changed)
      return changed.map(file => restoredNote(file, lock, conflicted))
    }
  }
  const exitCode = exitCodeOf(ran)
  if (context.config !== undefined && exitCode !== undefined && isWatched(context.config, command)) {
    const tree = await treeHash($, context.repo, index)
    await addRun($, context.paths, key, { command: command.trim(), exitCode, tree, at: iso(now) })
  }
  return []
}
