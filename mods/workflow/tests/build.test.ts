import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { UNLOCK } from '../src/labels'
import { parseWorkflow } from '../src/state'
import { ROOT, STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'
import type { Fake } from './engine'

const TEST_FILE = `${ROOT}/src/cart.test.ts`
const CODE_FILE = `${ROOT}/src/cart.ts`
const RED = 'pnpm vitest run src/cart.test.ts'
const CHECKS = [RED, 'pnpm lint', 'pnpm tsc --noEmit', 'pnpm test']
const LOCK_FILE = `${STATE_DIR}/locks/login.json`

function resultText(ran: { deny?: string; result?: unknown }): string {
  return ran.deny ?? String(ran.result)
}

async function bash($: Engine, fake: Fake, command: string, exitCode: number): Promise<void> {
  fake.bash.set(command, exitCode)
  await $.tool.call({ tool: 'Bash', command })
}

async function lockedSlice($: Engine, fake: Fake): Promise<void> {
  await bash($, fake, RED, 1)
  const locked = await $.tool.call({ tool: 'mcp__workflow__lock' })
  expect(resultText(locked)).toContain('Locked')
}

async function greenChecks($: Engine, fake: Fake): Promise<void> {
  for (const command of CHECKS) await bash($, fake, command, 0)
}

function repoWithTest(extra: Record<string, string> = {}): Record<string, string> {
  return buildRepo({ [TEST_FILE]: "it('totals', () => expect(total()).toBe(30))\n", [CODE_FILE]: 'export const total = () => 0\n', ...extra })
}

describe('lock', () => {
  test('without a failing run it says exactly what to run', async ($, on) => {
    fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__lock' })

    expect(resultText(ran)).toContain(`\`${RED}\``)
    expect(resultText(ran)).not.toContain('Locked')
  })

  test('after a failing run of that command it locks the slice tests', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)

    await lockedSlice($, fake)

    expect(JSON.parse(fake.files.get(LOCK_FILE) ?? '{}')).toMatchObject({ phase: 'green', sliceFiles: ['src/cart.test.ts'] })
    expect(fake.statuses.at(-1)).toBe('workflow login: build 1/2, tests locked')
  })

  test('a passing run does not count as red', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)
    await bash($, fake, RED, 0)

    const ran = await $.tool.call({ tool: 'mcp__workflow__lock' })

    expect(resultText(ran)).toContain('passed')
    expect(fake.files.has(LOCK_FILE)).toBe(false)
  })

  test('a run made before the last change does not count', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)
    await bash($, fake, RED, 1)
    await $.tool.call({ tool: 'Write', file_path: TEST_FILE, content: "it('totals', () => expect(total()).toBe(31))\n" })

    const ran = await $.tool.call({ tool: 'mcp__workflow__lock' })

    expect(resultText(ran)).toContain('since')
    expect(fake.files.has(LOCK_FILE)).toBe(false)
  })

  test('a lock file changed outside the mod is refused', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)
    await lockedSlice($, fake)
    fake.files.set(LOCK_FILE, (fake.files.get(LOCK_FILE) ?? '').replace('"green"', '"open"'))

    const ran = await $.tool.call({ tool: 'mcp__workflow__verify' })

    expect(resultText(ran)).toContain('changed outside the workflow mod')
  })
})

describe('frozen tests', () => {
  test('an Edit to a locked test is refused with the way out', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)
    await lockedSlice($, fake)

    const ran = await $.tool.call({ tool: 'Edit', file_path: TEST_FILE, old_string: 'toBe(30)', new_string: 'toBe(0)' })

    expect(ran.deny).toContain('mcp__workflow__unlock')
    expect(fake.files.get(TEST_FILE)).toContain('toBe(30)')
  })

  test('a locked test changed through the shell is restored', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)
    await lockedSlice($, fake)
    fake.files.set(TEST_FILE, 'weakened')

    const ran = await $.tool.call({ tool: 'Bash', command: "sed -i '' s/30/0/ src/cart.test.ts" })

    expect(fake.files.get(TEST_FILE)).toContain('toBe(30)')
    expect(ran.context?.join('\n')).toContain('restored src/cart.test.ts')
  })

  test('the code under test stays editable', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)
    await lockedSlice($, fake)

    const ran = await $.tool.call({ tool: 'Edit', file_path: CODE_FILE, old_string: '0', new_string: '30' })

    expect(ran.deny).toBeUndefined()
  })

  test('unlock asks the person, then the file may change', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)
    await lockedSlice($, fake)
    fake.answers.push(UNLOCK.yes)

    const unlocked = await $.tool.call({ tool: 'mcp__workflow__unlock', file: 'src/cart.test.ts', reason: 'the spec says 31' })
    const edited = await $.tool.call({ tool: 'Edit', file_path: TEST_FILE, old_string: 'toBe(30)', new_string: 'toBe(31)' })

    expect(fake.questions[0]).toContain('the spec says 31')
    expect(resultText(unlocked)).toContain('Unlocked')
    expect(edited.deny).toBeUndefined()
    expect(parseWorkflow(fake.files.get(`${STATE_DIR}/login.md`) ?? '').log.join('\n')).toContain('unlocked src/cart.test.ts: the spec says 31')
  })

  test('unlock changes nothing when the person keeps it locked', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)
    await lockedSlice($, fake)
    fake.answers.push(UNLOCK.no)

    await $.tool.call({ tool: 'mcp__workflow__unlock', file: 'src/cart.test.ts', reason: 'easier' })
    const edited = await $.tool.call({ tool: 'Edit', file_path: TEST_FILE, old_string: 'toBe(30)', new_string: 'toBe(0)' })

    expect(edited.deny).toBeDefined()
  })
})

describe('unlock typed by the person', () => {
  test('/workflow unlock lets the file change and logs the reason', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)
    await lockedSlice($, fake)

    const typed = await run($, 'unlock src/cart.test.ts the spec now says 31')
    const edited = await $.tool.call({ tool: 'Edit', file_path: TEST_FILE, old_string: 'toBe(30)', new_string: 'toBe(31)' })

    expect(typed.text).toContain('Unlocked src/cart.test.ts')
    expect(edited.deny).toBeUndefined()
    expect(fake.questions).toHaveLength(0)
  })

  test('the same command from anything but the person is refused', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)
    await lockedSlice($, fake)

    const sent = await $.command.run({
      command: 'workflow',
      args: 'unlock src/cart.test.ts because',
      origin: { kind: 'sdk' },
      presentation: { isFullscreen: false, columns: 80 },
    })
    const edited = await $.tool.call({ tool: 'Edit', file_path: TEST_FILE, old_string: 'toBe(30)', new_string: 'toBe(0)' })

    expect(sent.text).toContain('only the user')
    expect(edited.deny).toBeDefined()
  })
})

describe('auto_next', () => {
  test('a verified slice starts the next one in a fresh context when the turn ends', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest({ [`${STATE_DIR}/login.md`]: stateText({ auto_next: 'yes' }) }), 'feat/login')
    await start($)
    await lockedSlice($, fake)
    await greenChecks($, fake)
    await $.tool.call({ tool: 'mcp__workflow__verify' })

    await $.turn.complete({ answer: 'Slice 1 done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await fake.clock.settle()

    expect(fake.commands).toContain('clear')
    expect(fake.prompts.at(-1)).toContain('Slice 2: Password check')
  })

  test('without auto_next the turn ends and waits for /workflow next', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)
    await lockedSlice($, fake)
    await greenChecks($, fake)
    await $.tool.call({ tool: 'mcp__workflow__verify' })

    await $.turn.complete({ answer: 'Slice 1 done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await fake.clock.settle()

    expect(fake.commands).not.toContain('clear')
  })
})

describe('verify', () => {
  test('closes the slice once every check passed on the current code', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)
    await lockedSlice($, fake)
    await $.tool.call({ tool: 'Edit', file_path: CODE_FILE, old_string: '0', new_string: '30' })
    await greenChecks($, fake)

    const ran = await $.tool.call({ tool: 'mcp__workflow__verify' })

    expect(resultText(ran)).toContain('Slice 1 verified')
    expect(parseWorkflow(fake.files.get(`${STATE_DIR}/login.md`) ?? '')).toMatchObject({ slice: 2, phase: 'build' })
    expect(JSON.parse(fake.files.get(LOCK_FILE) ?? '{}')).toMatchObject({ phase: 'open' })
  })

  test('lists the checks still missing', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)
    await lockedSlice($, fake)
    await bash($, fake, RED, 0)

    const ran = await $.tool.call({ tool: 'mcp__workflow__verify' })

    expect(resultText(ran)).toContain('`pnpm lint`')
    expect(resultText(ran)).toContain('`pnpm test`')
  })

  test('refuses checks that passed before the code changed again', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)
    await lockedSlice($, fake)
    await greenChecks($, fake)
    await $.tool.call({ tool: 'Edit', file_path: CODE_FILE, old_string: '0', new_string: '30' })

    const ran = await $.tool.call({ tool: 'mcp__workflow__verify' })

    expect(resultText(ran)).not.toContain('verified')
  })

  test('the last slice moves the workflow to inspect', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest({ [`${STATE_DIR}/login.md`]: stateText({ slice: '2' }) }), 'feat/login')
    await start($)
    await lockedSlice($, fake)
    await greenChecks($, fake)

    await $.tool.call({ tool: 'mcp__workflow__verify' })

    expect(parseWorkflow(fake.files.get(`${STATE_DIR}/login.md`) ?? '')).toMatchObject({ phase: 'inspect' })
  })

  test('the next lock refuses a line removed from an earlier test', async ($, on) => {
    const fake = fakeEngine(on, repoWithTest(), 'feat/login')
    await start($)
    await lockedSlice($, fake)
    await greenChecks($, fake)
    await $.tool.call({ tool: 'mcp__workflow__verify' })
    await $.tool.call({ tool: 'Write', file_path: TEST_FILE, content: "it('totals', () => {})\n" })
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/login.test.ts`, content: "it('refuses', () => expect(login('x')).toBe(401))\n" })
    await bash($, fake, 'pnpm vitest run src/cart.test.ts src/login.test.ts', 1)

    const ran = await $.tool.call({ tool: 'mcp__workflow__lock' })

    expect(resultText(ran)).toContain("it('totals', () => expect(total()).toBe(30))")
    expect(JSON.parse(fake.files.get(LOCK_FILE) ?? '{}')).toMatchObject({ phase: 'open' })
  })
})
