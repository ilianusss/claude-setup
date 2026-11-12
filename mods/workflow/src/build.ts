import type { EngineInterface, ToolCallResult } from 'claude-code'

import { askOrUndefined } from './ask'
import { checksFor, isWatched, testFilesCommands } from './checks'
import { day, iso, submitLater } from './clock'
import type { Config } from './config'
import { readSlices, specsFolder } from './context'
import type { Context } from './context'
import { matchesAny } from './glob'
import { sha256 } from './hash'
import { NEXT_SLICE, UNLOCK } from './labels'
import { latestRun, removedLines } from './lock'
import type { Lock, LockedFile } from './lock'
import { NEXT_IN_ITS_OWN_TURN, phasePrompt, spawnBuild, stopPrompt } from './prompts'
import { refuse } from './refusal'
import { changedFiles, relativeTo, treeHash } from './repo'
import { addRun, readLock, readRuns, saveLock, saveWorkflow } from './store'
import { inPhase, withLog } from './state'
import type { Workflow } from './state'

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

async function restore($: EngineInterface, context: Context, lock: Lock, files: readonly string[]): Promise<void> {
  for (const file of files) {
    const locked = lock.files[file]
    if (locked !== undefined) await $.fs.write(`${context.repo.root}/${file}`, locked.content)
  }
}

export async function lockSlice($: EngineInterface, context: Context, now: number): Promise<string> {
  const workflow = inBuild(context)
  const config = configOf(context)
  const lock = await readLock($, context.paths, workflow.slug)
  if (lock?.phase === 'green') {
    refuse(`slice ${lock.slice} is locked already: implement until its checks pass, then call mcp__workflow__verify.`)
  }

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
  const tree = await treeHash($, context.repo, context.paths.treeIndex)
  const runs = await readRuns($, context.paths, workflow.slug)
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
  await saveLock($, context.paths, { slug: workflow.slug, slice: workflow.slice, phase: 'green', files, sliceFiles, unlocked: [], updated: iso(now) })
  await saveWorkflow(
    $,
    context.repo,
    context.paths,
    withLog({ ...workflow, updated: iso(now) }, day(now), `slice ${workflow.slice} tests locked: ${sliceFiles.join(', ')}`),
  )
  return [
    `Locked ${plural(sliceFiles.length, 'test file')} for slice ${workflow.slice}: ${sliceFiles.join(', ')}.`,
    '',
    'They are frozen until verify passes: the mod refuses edits to them and restores any change made through the shell. Implement the code, run each check exactly as written until it passes, then call mcp__workflow__verify:',
    ...checksFor(config, sliceFiles).map(command => `- \`${command}\``),
  ].join('\n')
}

export type Verified = { slice: number; closing: string[]; advanced: Workflow }

export async function verifySlice(
  $: EngineInterface,
  context: Context,
  now: number,
): Promise<Verified> {
  const workflow = inBuild(context)
  const config = configOf(context)
  const lock = await readLock($, context.paths, workflow.slug)
  if (lock === undefined || lock.phase !== 'green') {
    refuse(`nothing is locked for slice ${workflow.slice}: write its tests, see them fail, and call mcp__workflow__lock first.`)
  }

  const tampered = await changedLockedFiles($, context, lock)
  if (tampered.length > 0) {
    await restore($, context, lock, tampered)
    refuse(`these locked tests had changed and were restored: ${tampered.join(', ')}. Run the checks again on the restored tests.`)
  }

  const checks = checksFor(config, lock.sliceFiles)
  const tree = await treeHash($, context.repo, context.paths.treeIndex)
  const runs = await readRuns($, context.paths, workflow.slug)
  const missing = checks.filter(command => {
    const run = latestRun(runs, command)
    return run === undefined || run.tree !== tree || run.exitCode !== 0
  })
  if (missing.length > 0) {
    refuse(
      [
        `Slice ${workflow.slice} is not done yet. Run each of these exactly as written, on the current code, until it passes, then call mcp__workflow__verify again:`,
        ...missing.map(command => `- \`${command}\``),
      ].join('\n'),
    )
  }

  const files: Record<string, LockedFile> = { ...lock.files }
  for (const file of lock.unlocked) {
    const text = await readText($, context.repo.root, file)
    if (text === undefined) delete files[file]
    else files[file] = await snapshot(text)
  }
  await saveLock($, context.paths, { ...lock, files, phase: 'open', unlocked: [], updated: iso(now) })

  const slices = await readSlices($, context, workflow)
  const isLast = !slices.some(slice => slice.number > workflow.slice)
  const next: Workflow = isLast ? inPhase(workflow, 'inspect') : { ...workflow, slice: workflow.slice + 1 }
  const advanced = withLog({ ...next, updated: iso(now) }, day(now), `slice ${workflow.slice} verified`)
  await saveWorkflow($, context.repo, context.paths, advanced)

  const closing = [
    `1. Tick slice ${workflow.slice} in \`${specsFolder(context, workflow)}/slices.md\`.`,
    workflow.commits
      ? '2. Commit the slice, following the following-git-conventions skill.'
      : '2. Do not commit: in this workflow the user commits.',
  ]
  return { slice: workflow.slice, closing, advanced }
}

export async function verifiedForConversation($: EngineInterface, context: Context, verified: Verified): Promise<string> {
  const next = await nextStep($, context, verified.advanced)
  if (next.kind === 'go') submitLater($, `Slice ${verified.slice} of \`${verified.advanced.slug}\` is verified. Next:\n\n${next.text}`)
  return [
    `Slice ${verified.slice} verified.`,
    '',
    ...verified.closing,
    '',
    '## Next',
    '',
    next.kind === 'go' ? `Do the steps above. End your turn once they are done: ${NEXT_IN_ITS_OWN_TURN}` : next.text,
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

async function withStatus($: EngineInterface, context: Context, workflow: Workflow, status: 'active' | 'paused'): Promise<void> {
  if (workflow.status === status) return
  const now = await $.clock.now()
  await saveWorkflow($, context.repo, context.paths, withLog({ ...workflow, status, updated: iso(now) }, day(now), status === 'active' ? 'resumed' : 'paused'))
}

export type NextStep = { kind: 'go' | 'stop'; text: string }

export async function nextStep($: EngineInterface, context: Context, advanced: Workflow): Promise<NextStep> {
  if (advanced.phase === 'inspect') {
    await withStatus($, context, advanced, 'active')
    return {
      kind: 'go',
      text: `The build is done: "${advanced.slug}" is now in its inspect phase. Go straight on with it in this conversation:\n\n${await phasePrompt($, context, advanced)}`,
    }
  }
  if (advanced.autoNext) {
    await withStatus($, context, advanced, 'active')
    return { kind: 'go', text: `Call mcp__workflow__handoff with where things stand, then go straight on with slice ${advanced.slice}. ${spawnBuild(advanced)}` }
  }
  const answer = await askOrUndefined($, NEXT_SLICE.question(advanced.slug, advanced.slice - 1), [NEXT_SLICE.start(advanced.slice), NEXT_SLICE.stop], 'Next slice')
  if (answer === NEXT_SLICE.start(advanced.slice)) {
    await withStatus($, context, advanced, 'active')
    return { kind: 'go', text: `The user starts slice ${advanced.slice} now. Call mcp__workflow__handoff with where things stand, then: ${spawnBuild(advanced)}` }
  }
  await withStatus($, context, advanced, 'paused')
  return { kind: 'stop', text: `The user stops here; slice ${advanced.slice} is next. ${stopPrompt(advanced)}` }
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
  const lock = await readLock($, context.paths, workflow.slug)
  if (lock === undefined) refuse(`nothing is locked in "${workflow.slug}".`)
  const file = given.startsWith('/') ? (relativeTo(context.repo.root, given) ?? given) : given
  if (lock.files[file] === undefined) refuse(`${file} is not locked. Locked files: ${Object.keys(lock.files).join(', ')}.`)
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
  await saveLock($, context.paths, { ...lock, unlocked: [...lock.unlocked, file], updated: iso(now) })
  await saveWorkflow($, context.repo, context.paths, withLog({ ...workflow, updated: iso(now) }, day(now), `unlocked ${file}: ${reason}`))
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
  const lock = await readLock($, context.paths, workflow.slug)
  if (lock?.phase === 'green') {
    const changed = await changedLockedFiles($, context, lock)
    if (changed.length > 0) {
      await restore($, context, lock, changed)
      return changed.map(
        file =>
          `workflow: restored ${file}: it is a locked test of slice ${lock.slice} and that command changed it. Locked tests stay as written until verify passes; if one is wrong, call mcp__workflow__unlock with the reason.`,
      )
    }
  }
  const exitCode = exitCodeOf(ran)
  if (context.config !== undefined && exitCode !== undefined && isWatched(context.config, command)) {
    const tree = await treeHash($, context.repo, context.paths.treeIndex)
    await addRun($, context.paths, workflow.slug, { command: command.trim(), exitCode, tree, at: iso(now) })
  }
  return []
}
