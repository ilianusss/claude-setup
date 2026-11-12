import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ENDING, GATE } from '../src/labels'
import { parseWorkflow } from '../src/state'
import { ROOT, STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'
import type { Fake } from './engine'

const WORKTREE = `${ROOT}-login`
const BRANCH = 'feat/login'

// `toplevels` says where git puts a folder and what is below it: its top level, or null where git finds no repository.
// A folder not listed resolves as the fake resolves every folder.
type Where = { cwd: string; ignored: string; toplevels: Map<string, string | null> }

const IGNORED_LISTING = 'git status --ignored --porcelain'
const REPO_LOOKUP = 'git rev-parse --path-format=absolute --show-toplevel --git-common-dir --git-dir'

function ran(exitCode: number, stdout: string) {
  return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

function toplevelOf(where: Where, cwd: string): string | null | undefined {
  const folder = [...where.toplevels.keys()]
    .filter(key => cwd === key || cwd.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)[0]
  return folder === undefined ? undefined : where.toplevels.get(folder)
}

// A top level beside the main checkout is one of its linked worktrees; any other is a repository of its own.
function repoLookup(toplevel: string): string {
  if (toplevel === ROOT) return `${ROOT}\n${ROOT}/.git\n${ROOT}/.git\n`
  if (toplevel.startsWith(`${ROOT}-`)) return `${toplevel}\n${ROOT}/.git\n${ROOT}/.git/worktrees/x\n`
  return `${toplevel}\n${toplevel}/.git\n${toplevel}/.git\n`
}

function repo(fields: Partial<Record<string, string>> = {}): Record<string, string> {
  return buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ phase: 'inspect', worktree: WORKTREE, ...fields }) })
}

function doneRepo(): Record<string, string> {
  return repo({ phase: 'done', status: 'done' })
}

// The kit answers session.cwd with the main checkout, and the fake has no listing of ignored files and resolves every
// folder to one top level; a second hook on either event is refused: the fake's own registrations are swapped for ones
// that follow `where`, so a test can move the session in and out of the worktree, fill the worktree's ignored entries
// and say where git puts a folder. The worktree resolves to itself, as git resolves it.
function fakeIn(on: On, files: Record<string, string>, branch: string, cwd: string): { fake: Fake; where: Where } {
  const where: Where = { cwd, ignored: '', toplevels: new Map([[WORKTREE, WORKTREE]]) }
  const register = on as unknown as (event: string, ...rest: unknown[]) => unknown
  const followWhere =
    (fakeRun: (...args: unknown[]) => unknown) =>
    (_: unknown, e: { argv: readonly string[]; init?: { cwd?: string } }, ...rest: unknown[]) => {
      const line = e.argv.join(' ')
      if (line === IGNORED_LISTING) return ran(0, where.ignored)
      const toplevel = line === REPO_LOOKUP ? toplevelOf(where, e.init?.cwd ?? '') : undefined
      if (toplevel === null) return ran(128, '')
      if (toplevel !== undefined) return ran(0, repoLookup(toplevel))
      return fakeRun(_, e, ...rest)
    }
  const following = ((event: string, ...rest: unknown[]) => {
    if (event === 'session.cwd') return on('session.cwd', () => ({ value: where.cwd }))
    if (event === 'process.run') return register('process.run', followWhere(rest[0] as (...args: unknown[]) => unknown))
    return register(event, ...rest)
  }) as unknown as On
  return { fake: fakeEngine(following, files, branch), where }
}

function inLinkedWorktree(on: On, files: Record<string, string>, branch: string, toplevel: string, cwd = toplevel): void {
  const { fake } = fakeIn(on, files, branch, cwd)
  fake.toplevel = toplevel
  fake.isLinked = true
}

// git resolves the short name to the branch while no tag shares it.
function branchAt(fake: Fake, commit: string): void {
  fake.refs.set(BRANCH, commit)
  fake.refs.set(`refs/heads/${BRANCH}`, commit)
}

function pushed(fake: Fake): void {
  fake.unpushed = ''
  branchAt(fake, 'c1')
  fake.refs.set(`${BRANCH}@{u}`, 'c1')
}

function removals(fake: Fake): Array<{ cwd: string; line: string }> {
  return fake.gitRuns.filter(ran => ran.line.startsWith('worktree remove') || ran.line.startsWith('branch -D'))
}

function text(ran: { deny?: string; result?: unknown }): string {
  return ran.deny ?? String(ran.result)
}

function state(fake: Fake) {
  return parseWorkflow(fake.files.get(`${STATE_DIR}/login.md`) ?? '')
}

async function enterWorktree($: Engine): Promise<void> {
  await $.tool.call({ tool: 'EnterWorktree', path: WORKTREE })
}

async function approveLastGate($: Engine): Promise<string> {
  return text(await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Pull request opened.' }))
}

async function finish($: Engine, agentId?: string): Promise<{ deny?: string; result?: unknown }> {
  return $.tool.call({ tool: 'mcp__workflow__finish', agentId })
}

async function inWorktree($: Engine, on: On, files: Record<string, string> = repo()): Promise<{ fake: Fake; where: Where }> {
  const { fake, where } = fakeIn(on, files, BRANCH, WORKTREE)
  pushed(fake)
  await start($)
  await enterWorktree($)
  return { fake, where }
}

function leaveWorktree(fake: Fake, where: Where): void {
  where.cwd = ROOT
  fake.branch = 'main'
}

describe('the ending dialog (AC1)', () => {
  test('approving the last gate with a clean, pushed worktree asks whether to remove the worktree and the branch, naming both', async ($, on) => {
    const { fake } = await inWorktree($, on)
    fake.answers.push(GATE.approve, ENDING.keep)

    await approveLastGate($)

    expect(fake.questions[1]).toBe(ENDING.question(WORKTREE, BRANCH))
    expect(fake.questions[1]).toContain('/repo-login')
    expect(fake.questions[1]).toContain('feat/login')
  })

  test('a worktree holding ignored files names its top-level entries in the question, five at most, then a count', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    where.ignored = '!! .env\n!! node_modules/\n!! dist/\n!! src/generated/\n!! src/cache.log\n!! coverage/\n!! .cache/\n!! tmp/\n'
    fake.answers.push(GATE.approve, ENDING.keep)

    await approveLastGate($)

    const question = fake.questions[1] ?? ''
    expect(question).toContain('/repo-login')
    expect(question).toContain('ignored')
    expect(question).toContain('.env, node_modules/, dist/, src/, coverage/')
    expect(question).toContain('2 more')
    expect(question).not.toContain('.cache/')
    expect(question).not.toContain('generated')
  })

  test('a worktree without ignored entries gets the plain question', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    where.ignored = ''
    fake.answers.push(GATE.approve, ENDING.keep)

    await approveLastGate($)

    expect(fake.questions[1]).toBe(ENDING.question(WORKTREE, BRANCH))
    expect(fake.questions[1]).not.toContain('ignored')
  })

  test('a project is asked at the retro gate', async ($, on) => {
    const { fake } = await inWorktree($, on, repo({ size: 'project', phase: 'retro' }))
    fake.answers.push(GATE.approve, ENDING.keep)

    await approveLastGate($)

    expect(fake.questions[1]).toBe(ENDING.question(WORKTREE, BRANCH))
  })

  test("a project's inspect gate leads to the retro without the ending", async ($, on) => {
    const { fake } = await inWorktree($, on, repo({ size: 'project' }))
    fake.answers.push(GATE.approve)

    await approveLastGate($)

    expect(fake.questions).toHaveLength(1)
    expect(removals(fake)).toEqual([])
  })

  test('a workflow that ran in the main checkout is not offered any removal', async ($, on) => {
    const fake = fakeEngine(on, repo({ worktree: ROOT }), BRANCH)
    pushed(fake)
    fake.answers.push(GATE.approve)
    await start($)

    await approveLastGate($)

    expect(fake.questions).toHaveLength(1)
    expect(removals(fake)).toEqual([])
  })

  test('a workflow on a default branch is never offered the removal of that branch', async ($, on) => {
    const { fake } = fakeIn(on, repo({ branch: 'main' }), 'main', WORKTREE)
    fake.unpushed = ''
    fake.refs.set('main', 'c1')
    fake.refs.set('main@{u}', 'c1')
    fake.answers.push(GATE.approve, ENDING.remove)
    await start($)
    await enterWorktree($)

    const ran = await approveLastGate($)

    expect(fake.questions).toHaveLength(1)
    expect(ran).toContain('main')
    expect(removals(fake)).toEqual([])
  })
})

describe('keeping the worktree when a check fails (AC2)', () => {
  test('an uncommitted change keeps both and says so', async ($, on) => {
    const { fake } = await inWorktree($, on)
    fake.porcelain = '?? notes.txt\n'
    fake.answers.push(GATE.approve)

    const ran = await approveLastGate($)

    expect(fake.questions).toHaveLength(1)
    expect(ran).toContain('uncommitted')
    expect(ran).toContain('/workflow done login')
    expect(removals(fake)).toEqual([])
  })

  test('a branch with no upstream keeps both and says so', async ($, on) => {
    const { fake } = await inWorktree($, on)
    fake.unpushed = undefined
    fake.answers.push(GATE.approve)

    const ran = await approveLastGate($)

    expect(fake.questions).toHaveLength(1)
    expect(ran).toContain('no upstream')
    expect(removals(fake)).toEqual([])
  })

  test('commits not pushed keep both and say so', async ($, on) => {
    const { fake } = await inWorktree($, on)
    fake.unpushed = 'c2\n'
    fake.answers.push(GATE.approve)

    const ran = await approveLastGate($)

    expect(fake.questions).toHaveLength(1)
    expect(ran).toContain('not pushed')
    expect(removals(fake)).toEqual([])
  })

  test('the workflow is still closed when the worktree is kept', async ($, on) => {
    const { fake } = await inWorktree($, on)
    fake.porcelain = ' M src/login.ts\n'
    fake.answers.push(GATE.approve)

    await approveLastGate($)

    expect(state(fake)).toMatchObject({ phase: 'done', status: 'done' })
  })

  test('answering Keep them removes nothing and names /workflow done', async ($, on) => {
    const { fake } = await inWorktree($, on)
    fake.answers.push(GATE.approve, ENDING.keep)

    const ran = await approveLastGate($)

    expect(ran).toContain('/workflow done login')
    expect(removals(fake)).toEqual([])
  })

  test('a dismissed ending dialog removes nothing', async ($, on) => {
    const { fake } = await inWorktree($, on)
    fake.answers.push(GATE.approve)

    await approveLastGate($)

    expect(removals(fake)).toEqual([])
  })

  test('/workflow done offers the removal again once the worktree is clean', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    fake.porcelain = '?? notes.txt\n'
    fake.answers.push(GATE.approve)
    await approveLastGate($)
    fake.porcelain = ''
    leaveWorktree(fake, where)
    fake.answers.push(ENDING.keep)

    await run($, 'done login')

    expect(fake.questions.at(-1)).toBe(ENDING.question(WORKTREE, BRANCH))
  })

  test('/workflow done with an unpushed branch keeps both and says so', async ($, on) => {
    const { fake } = fakeIn(on, doneRepo(), 'main', ROOT)
    pushed(fake)
    fake.unpushed = 'c2\n'
    await start($)

    const ran = await run($, 'done login')

    expect(fake.questions).toEqual([])
    expect(ran.text).toContain('not pushed')
    expect(removals(fake)).toEqual([])
  })
})

describe('removing the worktree and the branch (AC3)', () => {
  test('on yes inside the worktree it entered, the conversation is told to leave it with keep, then call finish', async ($, on) => {
    const { fake } = await inWorktree($, on)
    fake.answers.push(GATE.approve, ENDING.remove)

    const ran = await approveLastGate($)

    expect(ran).toContain('ExitWorktree')
    expect(ran).toContain('"keep"')
    expect(ran).toContain('mcp__workflow__finish')
    expect(ran.indexOf('ExitWorktree')).toBeLessThan(ran.indexOf('mcp__workflow__finish'))
    expect(removals(fake)).toEqual([])
  })

  test('finish removes the worktree from the main checkout without forcing, then deletes the branch', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    fake.answers.push(GATE.approve, ENDING.remove)
    await approveLastGate($)
    leaveWorktree(fake, where)

    await finish($)

    expect(removals(fake)).toEqual([
      { cwd: ROOT, line: `worktree remove ${WORKTREE}` },
      { cwd: ROOT, line: `branch -D ${BRANCH}` },
    ])
    expect(fake.gitRuns.some(ran => ran.line.includes('--force'))).toBe(false)
  })

  test('finish logs the removal and the workflow stays listed as done', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    fake.answers.push(GATE.approve, ENDING.remove)
    await approveLastGate($)
    leaveWorktree(fake, where)

    await finish($)
    const listed = await run($, '')

    expect(state(fake).log.join('\n')).toContain('worktree removed')
    expect(state(fake)).toMatchObject({ phase: 'done', status: 'done' })
    expect(listed.text).toContain('login')
    expect(listed.text).toContain('done')
  })

  test('finish keeps a branch that is behind its upstream', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    branchAt(fake, 'c0')
    fake.answers.push(GATE.approve, ENDING.remove)
    await approveLastGate($)
    leaveWorktree(fake, where)

    const ran = text(await finish($))

    expect(removals(fake)).toEqual([{ cwd: ROOT, line: `worktree remove ${WORKTREE}` }])
    expect(ran).toContain(BRANCH)
  })

  test('when git refuses to remove the worktree, the branch is kept and nothing is logged', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    fake.worktreeRemoveExit = 1
    fake.answers.push(GATE.approve, ENDING.remove)
    await approveLastGate($)
    leaveWorktree(fake, where)

    await finish($)

    expect(removals(fake)).toEqual([{ cwd: ROOT, line: `worktree remove ${WORKTREE}` }])
    expect(state(fake).log.join('\n')).not.toContain('worktree removed')
  })

  test('/workflow done from the main checkout removes both directly when the user agrees', async ($, on) => {
    const { fake } = fakeIn(on, doneRepo(), 'main', ROOT)
    pushed(fake)
    fake.answers.push(ENDING.remove)
    await start($)

    await run($, 'done login')

    expect(fake.questions).toEqual([ENDING.question(WORKTREE, BRANCH)])
    expect(removals(fake)).toEqual([
      { cwd: ROOT, line: `worktree remove ${WORKTREE}` },
      { cwd: ROOT, line: `branch -D ${BRANCH}` },
    ])
  })

  test('/workflow done inside the worktree it entered asks Claude to leave it, then call finish', async ($, on) => {
    const { fake } = await inWorktree($, on, doneRepo())
    fake.answers.push(ENDING.remove)

    await run($, 'done login')
    await fake.clock.settle()

    expect(fake.prompts.at(-1)).toContain('ExitWorktree')
    expect(fake.prompts.at(-1)).toContain('mcp__workflow__finish')
    expect(removals(fake)).toEqual([])
  })

  test('a session that started inside the worktree is told to run /workflow done from the main checkout', async ($, on) => {
    const { fake } = fakeIn(on, repo(), BRANCH, WORKTREE)
    pushed(fake)
    fake.answers.push(GATE.approve, ENDING.remove)
    await start($)

    const ran = await approveLastGate($)

    expect(ran).toContain('/workflow done login')
    expect(ran).toContain('main checkout')
    expect(ran).not.toContain('mcp__workflow__finish')
    expect(removals(fake)).toEqual([])
  })
})

describe('mcp__workflow__finish is refused (AC4)', () => {
  test('while the session is inside the worktree', async ($, on) => {
    const { fake } = await inWorktree($, on)
    fake.answers.push(GATE.approve, ENDING.remove)
    await approveLastGate($)

    const ran = await finish($)

    expect(ran.deny).toContain('ExitWorktree')
    expect(removals(fake)).toEqual([])
  })

  test('and goes through once the session has left the worktree', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    fake.answers.push(GATE.approve, ENDING.remove)
    await approveLastGate($)
    await finish($)
    leaveWorktree(fake, where)

    await finish($)

    expect(removals(fake)).toHaveLength(2)
  })

  test('from a step agent', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    fake.answers.push(GATE.approve, ENDING.remove)
    await approveLastGate($)
    leaveWorktree(fake, where)

    const ran = await finish($, 'a1')

    expect(ran.deny).toContain('step agent')
    expect(removals(fake)).toEqual([])
  })

  test('when the user never agreed to the removal', async ($, on) => {
    const { fake } = fakeIn(on, doneRepo(), 'main', ROOT)
    pushed(fake)
    await start($)

    const ran = await finish($)

    expect(ran.deny).toBeDefined()
    expect(removals(fake)).toEqual([])
  })

  test('is registered as a workflow tool', async ($, on) => {
    const { fake } = await inWorktree($, on)

    expect(fake.tools).toContain('mcp__workflow__finish')
  })
})

describe('checking again at removal time (AC5)', () => {
  test('a change made between the dialog and finish removes nothing', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    fake.answers.push(GATE.approve, ENDING.remove)
    await approveLastGate($)
    leaveWorktree(fake, where)
    fake.porcelain = '?? late.txt\n'

    const ran = text(await finish($))

    expect(ran).toContain('uncommitted')
    expect(removals(fake)).toEqual([])
  })

  test('a commit made between the dialog and finish, leaving the branch ahead of its upstream, removes nothing', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    fake.answers.push(GATE.approve, ENDING.remove)
    await approveLastGate($)
    leaveWorktree(fake, where)
    fake.unpushed = 'c2\n'
    branchAt(fake, 'c2')

    const ran = text(await finish($))

    expect(ran).toContain('not pushed')
    expect(removals(fake)).toEqual([])
  })

  test('/workflow done: a change made while the dialog is open removes nothing', async ($, on) => {
    on('tool.call', { tool: 'AskUserQuestion' }, (_, e, next) => {
      fake.porcelain = '?? late.txt\n'
      return next(e)
    })
    const { fake } = fakeIn(on, doneRepo(), 'main', ROOT)
    pushed(fake)
    fake.answers.push(ENDING.remove)
    await start($)

    const ran = await run($, 'done login')

    expect(ran.text).toContain('uncommitted')
    expect(removals(fake)).toEqual([])
  })

  test('an ignored entry that appeared between the dialog and finish removes nothing, and is named', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    where.ignored = '!! .env\n'
    fake.answers.push(GATE.approve, ENDING.remove)
    await approveLastGate($)
    leaveWorktree(fake, where)
    where.ignored = '!! .env\n!! secrets.txt\n'

    const ran = text(await finish($))

    expect(ran).toContain('secrets.txt')
    expect(removals(fake)).toEqual([])
  })

  test('/workflow done: an ignored entry that appears while the dialog is open removes nothing', async ($, on) => {
    on('tool.call', { tool: 'AskUserQuestion' }, (_, e, next) => {
      where.ignored = '!! secrets.txt\n'
      return next(e)
    })
    const { fake, where } = fakeIn(on, doneRepo(), 'main', ROOT)
    pushed(fake)
    fake.answers.push(ENDING.remove)
    await start($)

    const ran = await run($, 'done login')

    expect(ran.text).toContain('secrets.txt')
    expect(removals(fake)).toEqual([])
  })

  test('the ignored entries the dialog named do not stop the removal', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    where.ignored = '!! .env\n!! node_modules/\n'
    fake.answers.push(GATE.approve, ENDING.remove)
    await approveLastGate($)
    leaveWorktree(fake, where)

    await finish($)

    expect(removals(fake)).toHaveLength(2)
  })

  test("finish keeps the branch when a tag of its name points at its upstream's commit and the branch does not", async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    fake.answers.push(GATE.approve, ENDING.remove)
    await approveLastGate($)
    leaveWorktree(fake, where)
    fake.refs.set(BRANCH, 'c1')
    fake.refs.set(`refs/heads/${BRANCH}`, 'c0')

    const ran = text(await finish($))

    expect(removals(fake)).toEqual([{ cwd: ROOT, line: `worktree remove ${WORKTREE}` }])
    expect(ran).toContain(BRANCH)
  })
})

describe('where the session is, as git resolves it', () => {
  const LINK = '/links/login'

  test('/workflow done from a folder git resolves to the worktree, under another path, asks Claude to leave it first', async ($, on) => {
    const { fake, where } = await inWorktree($, on, doneRepo())
    where.toplevels.set(LINK, WORKTREE)
    where.cwd = LINK
    fake.answers.push(ENDING.remove)

    await run($, 'done login')
    await fake.clock.settle()

    expect(fake.prompts.at(-1)).toContain('ExitWorktree')
    expect(removals(fake)).toEqual([])
  })

  test('finish from a folder git resolves to the worktree, under another path, is refused', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    fake.answers.push(GATE.approve, ENDING.remove)
    await approveLastGate($)
    where.toplevels.set(LINK, WORKTREE)
    where.cwd = LINK

    const ran = await finish($)

    expect(ran.deny).toContain('ExitWorktree')
    expect(removals(fake)).toEqual([])
  })

  test('finish from a repository nested in the worktree is refused', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    fake.answers.push(GATE.approve, ENDING.remove)
    await approveLastGate($)
    leaveWorktree(fake, where)
    where.toplevels.set(`${WORKTREE}/vendor/lib`, `${WORKTREE}/vendor/lib`)
    where.cwd = `${WORKTREE}/vendor/lib`

    const ran = await finish($)

    expect(ran.deny).toBeDefined()
    expect(removals(fake)).toEqual([])
  })

  test('/workflow done removes nothing when git cannot resolve the session folder once the user agreed', async ($, on) => {
    on('tool.call', { tool: 'AskUserQuestion' }, (_, e, next) => {
      where.toplevels.set(ROOT, null)
      return next(e)
    })
    const { fake, where } = fakeIn(on, doneRepo(), 'main', ROOT)
    pushed(fake)
    fake.answers.push(ENDING.remove)
    await start($)

    const ran = await run($, 'done login')

    expect(ran.text).toContain('/workflow done login')
    expect(removals(fake)).toEqual([])
  })

  test('finish removes nothing when git cannot resolve the session folder', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    fake.answers.push(GATE.approve, ENDING.remove)
    await approveLastGate($)
    leaveWorktree(fake, where)
    where.toplevels.set(ROOT, null)

    const ran = await finish($)

    expect(ran.deny).toBeDefined()
    expect(removals(fake)).toEqual([])
  })
})

describe('ExitWorktree with action remove', () => {
  test("is refused inside an open workflow's worktree, naming /workflow done and mcp__workflow__finish", async ($, on) => {
    inLinkedWorktree(on, repo(), BRANCH, WORKTREE)
    await start($)

    const ran = await $.tool.call({ tool: 'ExitWorktree', action: 'remove' })

    expect(ran.deny).toContain('/workflow done login')
    expect(ran.deny).toContain('mcp__workflow__finish')
  })

  test("is refused inside a done workflow's worktree, even with discard_changes", async ($, on) => {
    inLinkedWorktree(on, doneRepo(), BRANCH, WORKTREE)
    await start($)

    const ran = await $.tool.call({ tool: 'ExitWorktree', action: 'remove', discard_changes: true })

    expect(ran.deny).toContain('/workflow done login')
  })

  test("is refused in a subfolder of a workflow's worktree", async ($, on) => {
    inLinkedWorktree(on, repo(), BRANCH, WORKTREE, `${WORKTREE}/src`)
    await start($)

    const ran = await $.tool.call({ tool: 'ExitWorktree', action: 'remove' })

    expect(ran.deny).toContain('/workflow done login')
  })

  test('is refused from a step agent too', async ($, on) => {
    inLinkedWorktree(on, repo(), BRANCH, WORKTREE)
    await start($)

    const ran = await $.tool.call({ tool: 'ExitWorktree', action: 'remove', agentId: 'a1' })

    expect(ran.deny).toContain('/workflow done login')
  })

  test("with action keep is allowed inside a workflow's worktree", async ($, on) => {
    inLinkedWorktree(on, repo(), BRANCH, WORKTREE)
    await start($)

    const ran = await $.tool.call({ tool: 'ExitWorktree', action: 'keep' })

    expect(ran.deny).toBeUndefined()
  })

  test("is allowed outside any workflow's worktree", async ($, on) => {
    inLinkedWorktree(on, repo(), 'scratch', `${ROOT}-scratch`)
    await start($)

    const ran = await $.tool.call({ tool: 'ExitWorktree', action: 'remove' })

    expect(ran.deny).toBeUndefined()
  })

  test('is allowed in the worktree of an abandoned workflow', async ($, on) => {
    inLinkedWorktree(on, repo({ status: 'abandoned' }), BRANCH, WORKTREE)
    await start($)

    const ran = await $.tool.call({ tool: 'ExitWorktree', action: 'remove' })

    expect(ran.deny).toBeUndefined()
  })

  test('is allowed in a session worktree inside the main checkout an adopted workflow saved as its worktree', async ($, on) => {
    inLinkedWorktree(on, repo({ worktree: ROOT }), 'worktree-x', `${ROOT}/.claude/worktrees/x`)
    await start($)

    const ran = await $.tool.call({ tool: 'ExitWorktree', action: 'remove' })

    expect(ran.deny).toBeUndefined()
  })

  test('is allowed in the main checkout an adopted workflow saved as its worktree', async ($, on) => {
    fakeIn(on, repo({ worktree: ROOT }), BRANCH, ROOT)
    await start($)

    const ran = await $.tool.call({ tool: 'ExitWorktree', action: 'remove' })

    expect(ran.deny).toBeUndefined()
  })

  test("is refused when the session entered a workflow's worktree and the shell moved to the main checkout", async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    leaveWorktree(fake, where)

    const ran = await $.tool.call({ tool: 'ExitWorktree', action: 'remove' })

    expect(ran.deny).toContain('/workflow done login')
  })

  test("is refused when the session entered a workflow's worktree and the shell moved into a repository nested in it", async ($, on) => {
    const { where } = await inWorktree($, on)
    where.toplevels.set(`${WORKTREE}/vendor/lib`, `${WORKTREE}/vendor/lib`)
    where.cwd = `${WORKTREE}/vendor/lib`

    const ran = await $.tool.call({ tool: 'ExitWorktree', action: 'remove' })

    expect(ran.deny).toContain('/workflow done login')
  })

  test("is allowed when the worktree the session entered is an abandoned workflow's", async ($, on) => {
    const { fake, where } = await inWorktree($, on, repo({ status: 'abandoned' }))
    leaveWorktree(fake, where)

    const ran = await $.tool.call({ tool: 'ExitWorktree', action: 'remove' })

    expect(ran.deny).toBeUndefined()
  })

  test('is refused when git finds no repository in the session folder', async ($, on) => {
    const { where } = fakeIn(on, repo(), BRANCH, '/elsewhere')
    where.toplevels.set('/elsewhere', null)
    await start($)

    const ran = await $.tool.call({ tool: 'ExitWorktree', action: 'remove' })

    expect(ran.deny).toContain('keep')
  })

  test('is refused when git cannot resolve the worktree the session entered', async ($, on) => {
    const { fake, where } = await inWorktree($, on)
    leaveWorktree(fake, where)
    where.toplevels.set(WORKTREE, null)

    const ran = await $.tool.call({ tool: 'ExitWorktree', action: 'remove' })

    expect(ran.deny).toContain('keep')
  })
})
