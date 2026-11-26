import type { AgentSpawnInput, On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DELETE, ENDING, GATE, NEXT_SLICES, UNLOCK } from '../src/labels'
import { mergeMessage } from '../src/lanes'
import { parseWorkflow } from '../src/state'
import { laneKey } from '../src/store'
import { buildTask, integrationTask, parseTask, resolveTask } from '../src/tasks'
import { CONFIG, NOW, PROMPT_HINT, ROOT, STATE_DIR, buildRepo, fakeEngine, laneMergedWorkflow, run, spawnAgent, start, stateText } from './engine'
import type { Fake } from './engine'

const STATE_FILE = `${STATE_DIR}/login.md`
const SLICES_FILE = `${ROOT}/docs/specs/login/slices.md`
const LANE_1 = `${ROOT}-s1`
const LANE_3 = `${ROOT}-s3`
const RED = 'pnpm vitest run src/cart.test.ts'
const GREEN = [RED, 'pnpm lint', 'pnpm tsc --noEmit', 'pnpm test']
const CART_TEST = "it('totals', () => expect(total()).toBe(30))\n"

const LANE_SLICES = `# Slices: login

## Slice 1: Walking skeleton
- [ ] Done

Goal: a form posts to a stub route.
Design: Components
Depends on: none

## Slice 2: Password check
- [ ] Done

Goal: wrong passwords are refused.
Design: API contracts
Depends on: Slice 1

## Slice 3: Remember me
- [ ] Done

Depends on: none

## Slice 4: Logout
- [ ] Done

Depends on: none

## Slice 5: Audit log
- [ ] Done

Depends on: none
`

// The build agents the fake spawned, each running unless the test says otherwise.
function laneEngine(on: On, files: Record<string, string>, branch: string): Fake {
  const fake = fakeEngine(on, files, branch)
  on('agent.list', () => ({
    value: fake.spawns.map((_, index) => {
      const id = `agent-${index + 1}`
      return { id, type: 'workflow:build', description: 'Build a slice', status: fake.agentStatus.get(id) ?? ('running' as const) }
    }),
  }))
  return fake
}

function laneRepo(fields: Partial<Record<string, string>> = {}, extra: Record<string, string> = {}): Record<string, string> {
  return buildRepo({ [STATE_FILE]: stateText({ commits: 'yes', ...fields }), [SLICES_FILE]: LANE_SLICES, ...extra })
}

function state(fake: Fake) {
  return parseWorkflow(fake.files.get(STATE_FILE) ?? '')
}

const spawn = spawnAgent

function text(ran: { deny?: string; result?: unknown }): string {
  return ran.deny ?? String(ran.result)
}

// A lane git made, holding the slice's test and code, as the build agent working in it sees them.
function laneWithTest(fake: Fake, path: string, slice: number): void {
  fake.lanes.set(path, { branch: `feat/login-s${slice}`, porcelain: '' })
  fake.files.set(`${path}/.claude/workflow.json`, fake.files.get(`${ROOT}/.claude/workflow.json`) ?? '')
  fake.files.set(`${path}/src/cart.test.ts`, CART_TEST)
  fake.files.set(`${path}/src/cart.ts`, 'export const total = () => 0\n')
}

async function inLane(fake: Fake, path: string, act: () => Promise<void>): Promise<void> {
  fake.cwd = path
  await act()
  fake.cwd = ROOT
}

async function bash($: Engine, fake: Fake, command: string, exitCode: number, agentId: string): Promise<void> {
  fake.bash.set(command, exitCode)
  await $.tool.call({ tool: 'Bash', command, agentId })
}

async function lockInLane($: Engine, fake: Fake, path: string, agentId: string, red = RED): Promise<string> {
  let answer = ''
  await inLane(fake, path, async () => {
    await bash($, fake, red, 1, agentId)
    answer = text(await $.tool.call({ tool: 'mcp__workflow__lock', agentId }))
  })
  return answer
}

async function verifyInLane($: Engine, fake: Fake, path: string, agentId: string, red = RED): Promise<string> {
  let answer = ''
  await inLane(fake, path, async () => {
    for (const command of [red, ...GREEN.slice(1)]) await bash($, fake, command, 0, agentId)
    answer = text(await $.tool.call({ tool: 'mcp__workflow__verify', agentId }))
  })
  return answer
}

async function agentEnds($: Engine, fake: Fake, agentId: string | undefined): Promise<void> {
  await $.turn.complete({ answer: 'Slice built.', durationMs: 1, isAborted: false, turnId: `t-${agentId ?? 'main'}`, reason: 'answer', agentId })
  await fake.clock.settle()
}

// Spawns slice 1 into its lane, then has its agent lock and verify it there, as a build agent does.
async function verifiedLane($: Engine, fake: Fake): Promise<void> {
  await start($)
  await spawn($, buildTask('login', 1))
  fake.files.set(`${LANE_1}/src/cart.test.ts`, CART_TEST)
  fake.files.set(`${LANE_1}/src/cart.ts`, 'export const total = () => 30\n')
  await lockInLane($, fake, LANE_1, 'agent-1')
  await verifyInLane($, fake, LANE_1, 'agent-1')
}

function gitIn(fake: Fake, cwd: string): string[] {
  return fake.gitRuns.filter(run => run.cwd === cwd).map(run => run.line)
}

async function bandLeft($: Engine): Promise<string> {
  const ui = await $.ui.mount(PROMPT_HINT)
  const found = (await ui.find({ type: 'Text', text: /working|waiting for you/ }))?.text ?? ''
  await ui.unmount()
  return found
}

function spawned(fake: Fake): AgentSpawnInput | undefined {
  return fake.spawns.at(-1)
}

describe('the task a build prompt names', () => {
  test('reads the slice to build', () => {
    expect(parseTask(`Build it. ${buildTask('login', 3)} The user said yes.`, 'login')).toEqual({ kind: 'build', slice: 3 })
  })

  test('reads the merge to resolve', () => {
    expect(parseTask(resolveTask('login', 12), 'login')).toEqual({ kind: 'resolve', slice: 12 })
  })

  test('reads the integration to fix', () => {
    expect(parseTask(`${integrationTask('login')}\n\npnpm test failed.`, 'login')).toEqual({ kind: 'integration' })
  })

  test('reads nothing from a prompt that names no task', () => {
    expect(parseTask('Build the next slice.', 'login')).toBeUndefined()
  })

  test("reads nothing from another workflow's task", () => {
    expect(parseTask(buildTask('billing', 2), 'login')).toBeUndefined()
  })

  test('reads nothing from a prompt that names two tasks', () => {
    expect(parseTask(`${buildTask('login', 2)} ${buildTask('login', 3)}`, 'login')).toBeUndefined()
  })

  test('takes a slug with a dot as written, not as a pattern', () => {
    expect(parseTask(buildTask('v1x2', 2), 'v1.2')).toBeUndefined()
  })
})

describe('the state of a workflow', () => {
  test('keeps both of two updates made at the same time', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'intake', slice: '0' }) }), 'feat/login')
    await start($)

    await Promise.all([
      $.tool.call({ tool: 'mcp__workflow__handoff', stopped: 'Listening.', next: 'Ask about the limits.' }),
      $.tool.call({ tool: 'mcp__workflow__progress', step: 2 }),
    ])

    expect(parseWorkflow(fake.files.get(STATE_FILE) ?? '')).toMatchObject({ stopped: 'Listening.', step: 2 })
  })
})

describe('spawning a slice in a workflow that commits', () => {
  test('creates the lane: a branch and a worktree beside the workflow, from its branch', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)

    await spawn($, buildTask('login', 1))

    expect(fake.gitRuns).toContainEqual({ cwd: ROOT, line: `worktree add -b feat/login-s1 ${LANE_1} feat/login` })
    expect(state(fake).lanes).toEqual([{ slice: 1, branch: 'feat/login-s1', worktree: LANE_1, verified: false }])
  })

  test('sends the agent into its lane with the slice and its design sections', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)

    await spawn($, buildTask('login', 1))

    expect(spawned(fake)?.cwd).toBe(LANE_1)
    expect(spawned(fake)?.prompt.startsWith(buildTask('login', 1))).toBe(true)
    expect(spawned(fake)?.prompt).toContain('Goal: a form posts to a stub route.')
    expect(spawned(fake)?.prompt).toContain('Form and route.')
  })

  test('tells the agent to run the worktree setup first when the project names one', async ($, on) => {
    const fake = laneEngine(on, laneRepo({}, { [`${ROOT}/.claude/workflow.json`]: JSON.stringify({ ...CONFIG, worktreeSetup: 'pnpm install --frozen-lockfile' }) }), 'feat/login')
    await start($)

    await spawn($, buildTask('login', 1))

    expect(spawned(fake)?.prompt).toContain('Run `pnpm install --frozen-lockfile` first, in your folder')
  })

  test('names no setup when the project has none', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)

    await spawn($, buildTask('login', 1))

    expect(spawned(fake)?.prompt).not.toContain('first, in your folder')
  })

  test('sends an agent spawned again for a lane with no agent running into that lane, without creating it again', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building]' }, { [`${LANE_1}/src/cart.ts`]: 'export const total = () => 0\n' }), 'feat/login')
    fake.lanes.set(LANE_1, { branch: 'feat/login-s1', porcelain: '' })
    await start($)

    await spawn($, buildTask('login', 1))

    expect(spawned(fake)?.cwd).toBe(LANE_1)
    expect(fake.gitRuns.filter(run => run.line.startsWith('worktree add'))).toEqual([])
  })

  test('leaves the spawn of a subagent alone', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)

    const ran = await spawn($, 'Look at the tests.', { parentAgentId: 'agent-9' })

    expect(ran.deny).toBeUndefined()
    expect(spawned(fake)?.prompt).toBe('Look at the tests.')
    expect(spawned(fake)?.cwd).toBeUndefined()
  })

  test('leaves a spawn outside the build phase alone', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ phase: 'inspect' }), 'feat/login')
    await start($)

    const ran = await spawn($, 'Fix the review findings: the total is wrong.')

    expect(ran.deny).toBeUndefined()
    expect(spawned(fake)?.prompt).toBe('Fix the review findings: the total is wrong.')
  })
})

describe('a spawn the hook refuses', () => {
  test('a prompt that names no slice, with the prompts to use instead', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)

    const ran = await spawn($, 'Build the next slice.')

    expect(ran.deny).toContain(buildTask('login', 1))
    expect(ran.deny).toContain(buildTask('login', 3))
    expect(fake.spawns).toHaveLength(0)
  })

  test('a slice that is done', async ($, on) => {
    const fake = laneEngine(on, laneRepo({}, { [SLICES_FILE]: LANE_SLICES.replace('- [ ] Done', '- [x] Done') }), 'feat/login')
    await start($)

    const ran = await spawn($, buildTask('login', 1))

    expect(ran.deny).toContain('slice 1 is done')
    expect(fake.spawns).toHaveLength(0)
  })

  test('a slice whose dependencies are not done', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)

    const ran = await spawn($, buildTask('login', 2))

    expect(ran.deny).toContain('slice 2 waits for slice 1')
    expect(fake.lanes.size).toBe(0)
  })

  test('a fourth lane while three run', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)
    for (const slice of [1, 3, 4]) await spawn($, buildTask('login', slice))

    const ran = await spawn($, buildTask('login', 5))

    expect(ran.deny).toContain('3 lanes')
    expect(state(fake).lanes.map(lane => lane.slice)).toEqual([1, 3, 4])
  })

  test('a slice whose agent runs already', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)
    await spawn($, buildTask('login', 1))

    const ran = await spawn($, buildTask('login', 1))

    expect(ran.deny).toContain('already')
    expect(fake.spawns).toHaveLength(1)
  })

  test('a lane folder that exists and is not that lane', async ($, on) => {
    const fake = laneEngine(on, laneRepo({}, { [`${LANE_1}/notes.txt`]: 'mine' }), 'feat/login')
    await start($)

    const ran = await spawn($, buildTask('login', 1))

    expect(ran.deny).toContain(LANE_1)
    expect(fake.gitRuns.filter(run => run.line.startsWith('worktree add'))).toEqual([])
  })
})

describe('spawning a slice in a workflow that does not commit', () => {
  test('builds the current slice in the workflow worktree, with its text and design sections', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')
    await start($)

    await spawn($, buildTask('login', 1))

    expect(spawned(fake)?.cwd).toBeUndefined()
    expect(spawned(fake)?.prompt).toContain('Goal: a form posts to a stub route.')
    expect(fake.lanes.size).toBe(0)
    expect(state(fake).lanes).toEqual([])
  })

  test('refuses another slice than the current one', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')
    await start($)

    const ran = await spawn($, buildTask('login', 2))

    expect(ran.deny).toContain(buildTask('login', 1))
    expect(fake.spawns).toHaveLength(0)
  })
})

describe('the lock in a lane', () => {
  test("keeps the lane's own lock, runs and tree index, and leaves the workflow's alone", async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    await start($)

    const locked = await lockInLane($, fake, LANE_1, 'agent-1')

    expect(locked).toContain('Locked 1 test file for slice 1')
    expect(JSON.parse(fake.files.get(`${STATE_DIR}/locks/lanes/login/1.json`) ?? '{}')).toMatchObject({ phase: 'green', slice: 1, sliceFiles: ['src/cart.test.ts'] })
    expect(fake.files.has(`${STATE_DIR}/locks/login.json`)).toBe(false)
    expect(fake.files.has(`${STATE_DIR}/runs/lanes/login/1.json`)).toBe(true)
    expect(new Set(fake.indexFiles)).toEqual(new Set([`${STATE_DIR}/lanes/login/1.index`]))
  })

  test("is refused in the workflow's worktree of a workflow that commits", async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)
    fake.bash.set(RED, 1)
    await $.tool.call({ tool: 'Bash', command: RED })

    const ran = await $.tool.call({ tool: 'mcp__workflow__lock' })

    expect(ran.deny).toContain('in a lane')
  })

  test('refuses an Edit to a test it locked', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    await start($)
    await lockInLane($, fake, LANE_1, 'agent-1')
    fake.cwd = LANE_1

    const ran = await $.tool.call({ tool: 'Edit', file_path: `${LANE_1}/src/cart.test.ts`, old_string: 'toBe(30)', new_string: 'toBe(0)', agentId: 'agent-1' })

    expect(ran.deny).toContain('locked test of slice 1')
  })

  test("is unlocked from the workflow's worktree, after the user's yes", async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    await start($)
    await lockInLane($, fake, LANE_1, 'agent-1')
    fake.answers.push(UNLOCK.yes)

    const ran = await $.tool.call({ tool: 'mcp__workflow__unlock', file: 'src/cart.test.ts', reason: 'the spec says 31' })

    expect(text(ran)).toContain('Unlocked src/cart.test.ts')
    expect(JSON.parse(fake.files.get(`${STATE_DIR}/locks/lanes/login/1.json`) ?? '{}')).toMatchObject({ unlocked: ['src/cart.test.ts'] })
  })
})

describe('verify in a lane', () => {
  test('marks the lane verified, keeps its lock green and leaves the current slice alone', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    await start($)
    await lockInLane($, fake, LANE_1, 'agent-1')

    const verified = await verifyInLane($, fake, LANE_1, 'agent-1')

    expect(verified).toContain('Slice 1 verified')
    expect(state(fake)).toMatchObject({ slice: 1, phase: 'build', lanes: [{ slice: 1, verified: true }] })
    expect(JSON.parse(fake.files.get(`${STATE_DIR}/locks/lanes/login/1.json`) ?? '{}')).toMatchObject({ phase: 'green' })
  })

  test('tells the agent to commit on its branch and not to tick slices.md', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    await start($)
    await lockInLane($, fake, LANE_1, 'agent-1')

    const verified = await verifyInLane($, fake, LANE_1, 'agent-1')

    expect(verified).toContain('Commit the slice on the branch `feat/login-s1`')
    expect(verified).toContain('Do not tick slice 1')
  })

  test('two lanes lock and verify between each other, and the state keeps both', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building, 3 building]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    laneWithTest(fake, LANE_3, 3)
    await start($)

    await lockInLane($, fake, LANE_1, 'agent-1')
    await lockInLane($, fake, LANE_3, 'agent-3')
    await verifyInLane($, fake, LANE_1, 'agent-1')
    await verifyInLane($, fake, LANE_3, 'agent-3')

    expect(state(fake).lanes.map(lane => [lane.slice, lane.verified])).toEqual([[1, true], [3, true]])
    expect(state(fake).log.filter(entry => entry.includes('tests locked'))).toHaveLength(2)
  })
})

describe('writes in a lane', () => {
  test("refuses a write to the workflow's worktree", async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    await start($)
    fake.cwd = LANE_1

    const ran = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/cart.ts`, content: 'export {}\n', agentId: 'agent-1' })

    expect(ran.deny).toContain(LANE_1)
    expect(fake.files.get(`${ROOT}/src/cart.ts`)).toBeUndefined()
  })

  test('refuses a write to another lane', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building, 3 building]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    laneWithTest(fake, LANE_3, 3)
    await start($)
    fake.cwd = LANE_1

    const ran = await $.tool.call({ tool: 'Write', file_path: `${LANE_3}/src/cart.ts`, content: 'export {}\n', agentId: 'agent-1' })

    expect(ran.deny).toContain(LANE_1)
  })

  test('lets a write inside the lane through', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    await start($)
    fake.cwd = LANE_1

    const ran = await $.tool.call({ tool: 'Write', file_path: `${LANE_1}/src/cart.ts`, content: 'export const total = () => 30\n', agentId: 'agent-1' })

    expect(ran.deny).toBeUndefined()
  })
})

describe('the end of a lane whose slice is verified', () => {
  test('merges its branch into the workflow branch, without a fast-forward, in the workflow worktree', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)

    await agentEnds($, fake, 'agent-1')

    expect(gitIn(fake, ROOT)).toEqual(
      expect.arrayContaining(['merge --no-ff --no-commit feat/login-s1', 'add -- docs/specs/login/slices.md', 'commit -m feat: merge slice 1 (Walking skeleton)']),
    )
    expect(fake.files.get(`${ROOT}/src/cart.ts`)).toBe('export const total = () => 30\n')
  })

  test('ticks the slice in the slices.md of the workflow worktree', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)

    await agentEnds($, fake, 'agent-1')

    expect(fake.files.get(SLICES_FILE)).toContain('## Slice 1: Walking skeleton\n- [x] Done')
  })

  test("adds the lane's locked tests to the workflow lock, and deletes the lane's own files", async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)

    await agentEnds($, fake, 'agent-1')

    expect(JSON.parse(fake.files.get(`${STATE_DIR}/locks/login.json`) ?? '{}')).toMatchObject({ phase: 'open', files: { 'src/cart.test.ts': { content: CART_TEST } } })
    expect(fake.files.has(`${STATE_DIR}/locks/lanes/login/1.json`)).toBe(false)
    expect(fake.rmRuns.at(-1)).toEqual(['-f', '--', `${STATE_DIR}/locks/lanes/login/1.json`, `${STATE_DIR}/locks/lanes/login/1.seed.json`, `${STATE_DIR}/runs/lanes/login/1.json`, `${STATE_DIR}/lanes/login/1.index`])
  })

  test('removes the lane worktree and its branch without forcing, and the lane leaves the state', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)

    await agentEnds($, fake, 'agent-1')

    expect(gitIn(fake, ROOT)).toEqual(expect.arrayContaining([`worktree remove ${LANE_1}`, 'branch -d feat/login-s1']))
    expect(fake.gitRuns.some(run => run.line.includes('--force') || run.line.includes('-D'))).toBe(false)
    expect(state(fake).lanes).toEqual([])
    expect(state(fake).log.at(-1)).toContain('slice 1 merged')
  })

  test('hands the conversation the merge, the integration checks and the slices now ready', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)

    await agentEnds($, fake, 'agent-1')

    expect(fake.prompts).toHaveLength(1)
    expect(fake.prompts[0]).toContain('merged `feat/login-s1` into `feat/login`')
    expect(fake.prompts[0]).toContain('`pnpm lint`, `pnpm tsc --noEmit`, `pnpm test`')
    expect(fake.prompts[0]).toContain(integrationTask('login'))
    expect(fake.prompts[0]).toContain(`"${buildTask('login', 2)}"`)
    expect(fake.prompts[0]).toContain(`"${buildTask('login', 3)}"`)
    expect(fake.prompts[0]).toContain(`"${buildTask('login', 4)}"`)
    expect(fake.prompts[0]).not.toContain(buildTask('login', 5))
  })

  test('lists only as many new slices as lanes are free, and waits for the lanes still building', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    await spawn($, buildTask('login', 3))
    await spawn($, buildTask('login', 4))

    await agentEnds($, fake, 'agent-1')

    expect(fake.prompts[0]).toContain(`"${buildTask('login', 2)}"`)
    expect(fake.prompts[0]).not.toContain(buildTask('login', 5))
    expect(fake.prompts[0]).toContain('Slices 3, 4 still build')
  })

  test('without slice chaining, asks the user before new slices start', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    fake.answers.push(NEXT_SLICES.start)
    await verifiedLane($, fake)

    await agentEnds($, fake, 'agent-1')

    expect(fake.questions).toEqual([NEXT_SLICES.question('login', [2, 3, 4])])
    expect(fake.prompts[0]).toContain(buildTask('login', 2))
  })

  test('without slice chaining, Stop here starts nothing and pauses the workflow when no lane runs', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    fake.answers.push(NEXT_SLICES.stop)
    await verifiedLane($, fake)

    await agentEnds($, fake, 'agent-1')

    expect(fake.prompts[0]).not.toContain(buildTask('login', 2))
    expect(fake.prompts[0]).toContain('mcp__workflow__handoff')
    expect(state(fake).status).toBe('paused')
  })

  test('the last slice merged moves the workflow to inspect, after the integration checks', async ($, on) => {
    const done = LANE_SLICES.replaceAll('- [ ] Done', '- [x] Done').replace('## Slice 1: Walking skeleton\n- [x] Done', '## Slice 1: Walking skeleton\n- [ ] Done')
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }, { [SLICES_FILE]: done }), 'feat/login')
    await verifiedLane($, fake)

    await agentEnds($, fake, 'agent-1')

    expect(state(fake).phase).toBe('inspect')
    expect(fake.prompts[0]).toContain(integrationTask('login'))
    expect(fake.prompts[0]).toContain('Do the inspect work.')
  })

  test('the last slice merged registers the build agent again, for the fixes of the inspect phase', async ($, on) => {
    const done = LANE_SLICES.replaceAll('- [ ] Done', '- [x] Done').replace('## Slice 1: Walking skeleton\n- [x] Done', '## Slice 1: Walking skeleton\n- [ ] Done')
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }, { [SLICES_FILE]: done }), 'feat/login')
    await verifiedLane($, fake)

    await agentEnds($, fake, 'agent-1')

    expect(fake.agents.filter(spec => spec.name === 'build').at(-1)?.prompt).toContain('## Fixing review findings')
  })

  test('a run that ends without a verified lane hands nothing over and merges nothing', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await start($)
    await spawn($, buildTask('login', 1))

    await agentEnds($, fake, 'agent-1')

    expect(fake.prompts).toHaveLength(0)
    expect(fake.gitRuns.some(run => run.line.startsWith('merge'))).toBe(false)
    expect(state(fake).lanes).toHaveLength(1)
  })
})

describe('a lane that does not merge', () => {
  test('a conflict aborts the merge, keeps the lane unverified and asks for its resolution', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    fake.mergeExit = 1

    await agentEnds($, fake, 'agent-1')

    expect(gitIn(fake, ROOT)).toContain('merge --abort')
    expect(gitIn(fake, ROOT)).not.toContain(`worktree remove ${LANE_1}`)
    expect(state(fake).lanes).toEqual([{ slice: 1, branch: 'feat/login-s1', worktree: LANE_1, verified: false }])
    expect(fake.prompts[0]).toContain(`"${resolveTask('login', 1)}"`)
    expect(fake.files.get(SLICES_FILE)).toContain('## Slice 1: Walking skeleton\n- [ ] Done')
  })

  test('the resolving agent goes into the same lane, merges the workflow branch in and verifies again', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    fake.mergeExit = 1
    await agentEnds($, fake, 'agent-1')

    await spawn($, resolveTask('login', 1))

    expect(spawned(fake)?.cwd).toBe(LANE_1)
    expect(spawned(fake)?.prompt).toContain('git merge feat/login')
    expect(spawned(fake)?.prompt).toContain('mcp__workflow__verify')
  })

  test('once resolved and verified again, the end of its run merges the lane', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    fake.mergeExit = 1
    await agentEnds($, fake, 'agent-1')
    await spawn($, resolveTask('login', 1))
    fake.mergeExit = 0

    await verifyInLane($, fake, LANE_1, 'agent-2')
    await agentEnds($, fake, 'agent-2')

    expect(state(fake).lanes).toEqual([])
    expect(fake.files.get(SLICES_FILE)).toContain('## Slice 1: Walking skeleton\n- [x] Done')
  })

  test('a failed commit aborts the merge too', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    fake.commitExit = 1

    await agentEnds($, fake, 'agent-1')

    expect(gitIn(fake, ROOT)).toContain('merge --abort')
    expect(state(fake).lanes).toHaveLength(1)
    expect(fake.prompts[0]).toContain(resolveTask('login', 1))
  })

  test('uncommitted changes in the lane stop the merge, and the agent is spawned again to commit them', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    fake.lanes.set(LANE_1, { branch: 'feat/login-s1', porcelain: ' M src/cart.ts\n' })

    await agentEnds($, fake, 'agent-1')

    expect(fake.gitRuns.some(run => run.line.startsWith('merge'))).toBe(false)
    expect(state(fake).lanes).toEqual([{ slice: 1, branch: 'feat/login-s1', worktree: LANE_1, verified: false }])
    expect(fake.prompts[0]).toContain(`"${buildTask('login', 1)}"`)
  })

  test("uncommitted changes in the workflow's worktree stop the merge", async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    fake.porcelain = ' M README.md\n'

    await agentEnds($, fake, 'agent-1')

    expect(fake.gitRuns.some(run => run.line.startsWith('merge'))).toBe(false)
    expect(fake.prompts[0]).toContain('uncommitted changes')
  })

  test('a worktree git cannot remove is named for the user, and the lane still leaves the state', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    fake.worktreeRemoveExit = 1

    await agentEnds($, fake, 'agent-1')

    expect(state(fake).lanes).toEqual([])
    expect(fake.prompts[0]).toContain(`remove the worktree ${LANE_1}`)
    expect(gitIn(fake, ROOT)).not.toContain('branch -d feat/login-s1')
  })
})

describe('the merge commit message', () => {
  test('follows the commit header convention', () => {
    expect(mergeMessage(3, 'Password check')).toBe('feat: merge slice 3 (Password check)')
  })

  test('keeps the header within 72 characters', () => {
    expect(mergeMessage(12, 'A very long slice name that goes on and on well past what a header holds').length).toBeLessThanOrEqual(72)
  })
})

describe('a hand-over that arrives during a turn', () => {
  test('waits for the end of the turn, then goes as one prompt', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    await $.prompt.submit({ text: 'How is it going?', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: 'How is it going?', turnId: 'main-1' })
    const before = fake.prompts.length

    await agentEnds($, fake, 'agent-1')
    const during = fake.prompts.length
    await agentEnds($, fake, undefined)

    expect(during).toBe(before)
    expect(fake.prompts).toHaveLength(before + 1)
    expect(fake.prompts.at(-1)).toContain('merged `feat/login-s1`')
  })

  test('joins several hand-overs that waited into one prompt', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await start($)
    await spawn($, buildTask('login', 1))
    await spawn($, buildTask('login', 3))
    for (const [path, agentId] of [[LANE_1, 'agent-1'], [LANE_3, 'agent-2']] as const) {
      fake.files.set(`${path}/src/cart.test.ts`, CART_TEST)
      await lockInLane($, fake, path, agentId)
      await verifyInLane($, fake, path, agentId)
    }
    await $.prompt.submit({ text: 'How is it going?', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: 'How is it going?', turnId: 'main-1' })
    const before = fake.prompts.length

    await agentEnds($, fake, 'agent-1')
    await agentEnds($, fake, 'agent-2')
    await agentEnds($, fake, undefined)

    expect(fake.prompts).toHaveLength(before + 1)
    expect(fake.prompts.at(-1)).toContain('merged `feat/login-s1`')
    expect(fake.prompts.at(-1)).toContain('merged `feat/login-s3`')
  })

  test('goes at once when the conversation waits', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)

    await agentEnds($, fake, 'agent-1')

    expect(fake.prompts).toHaveLength(1)
  })
})

describe('the build phase prompt of a workflow that commits', () => {
  test('lists the ready slices to spawn in one message, in the background, at most three, each with its exact prompt', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)

    await run($, 'continue')
    await fake.clock.settle()

    expect(fake.prompts[0]).toContain('in one message')
    expect(fake.prompts[0]).toContain('run_in_background: true')
    for (const slice of [1, 3, 4]) expect(fake.prompts[0]).toContain(`- "${buildTask('login', slice)}"`)
    expect(fake.prompts[0]).not.toContain(buildTask('login', 5))
    expect(fake.prompts[0]).not.toContain(buildTask('login', 2))
  })

  test('tells the conversation to end its turn, saying the slices build in parallel and the mod reports each', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)

    await run($, 'continue')
    await fake.clock.settle()

    expect(fake.prompts[0]).toContain('end your turn, telling the user that the slices build in parallel and that the mod reports each as it ends')
  })

  test('on resume, spawns the lanes left in the state again before the free lanes take new slices', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[3 building, 4 building]' }), 'feat/login')
    await start($)

    await run($, 'continue')
    await fake.clock.settle()

    for (const slice of [3, 4, 1]) expect(fake.prompts[0]).toContain(`- "${buildTask('login', slice)}"`)
    expect(fake.prompts[0]).not.toContain(buildTask('login', 5))
  })

  test('a lane spawned again on resume goes into its existing worktree', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[4 building]' }, { [`${ROOT}-s4/src/logout.ts`]: 'export {}\n' }), 'feat/login')
    fake.lanes.set(`${ROOT}-s4`, { branch: 'feat/login-s4', porcelain: '' })
    await start($)

    await spawn($, buildTask('login', 4))

    expect(spawned(fake)?.cwd).toBe(`${ROOT}-s4`)
    expect(spawned(fake)?.prompt).toContain('exists from an earlier run')
  })
})

describe('fixing the integration', () => {
  test("runs in the workflow's worktree with the integration instructions", async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)

    await spawn($, `${integrationTask('login')}\n\npnpm test failed: total is 0.`)

    expect(spawned(fake)?.cwd).toBeUndefined()
    expect(spawned(fake)?.prompt).toContain('## Fixing the integration')
    expect(fake.lanes.size).toBe(0)
  })
})

describe("a lane's first lock", () => {
  test('refuses a line removed from a test a merged slice locked', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    await agentEnds($, fake, 'agent-1')
    await spawn($, buildTask('login', 3))
    fake.files.set(`${LANE_3}/src/cart.test.ts`, "it('totals', () => {})\n")
    fake.files.set(`${LANE_3}/src/remember.test.ts`, "it('remembers', () => expect(remember()).toBe(true))\n")

    let locked = ''
    await inLane(fake, LANE_3, async () => {
      await bash($, fake, 'pnpm vitest run src/cart.test.ts src/remember.test.ts', 1, 'agent-3')
      locked = text(await $.tool.call({ tool: 'mcp__workflow__lock', agentId: 'agent-3' }))
    })

    expect(locked).toContain("it('totals', () => expect(total()).toBe(30))")
    expect(fake.files.has(`${STATE_DIR}/locks/lanes/login/3.json`)).toBe(false)
  })
})

describe('the band while lanes run', () => {
  test('reads the slices done out of all, then the slices building in lanes', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building, 3 building]' }), 'feat/login')

    await start($)

    expect(fake.statuses.at(-1)).toBe('workflow login: build 0/5: slices 1 3, opus medium, waiting for you')
    expect(await bandLeft($)).toBe('build 0/5: slices 1 3 · opus medium · waiting for you')
  })

  test('counts a merged slice as done and names the one lane left', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    await spawn($, buildTask('login', 3))

    await agentEnds($, fake, 'agent-1')

    expect(fake.statuses.at(-1)).toContain('build 1/5: slice 3,')
  })

  test('reads only the count when no lane runs', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')

    await start($)

    expect(fake.statuses.at(-1)).toBe('workflow login: build 0/5, opus medium, waiting for you')
  })
})

describe('lanes left when a workflow ends', () => {
  test('/workflow delete removes a lane that is clean and merged, without forcing', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 verified]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    fake.answers.push(DELETE.yes)
    await start($)

    await run($, 'delete login')

    expect(gitIn(fake, ROOT)).toEqual(expect.arrayContaining([`worktree remove ${LANE_1}`, 'branch -d feat/login-s1']))
    expect(fake.gitRuns.some(found => found.line.includes('--force') || found.line.includes('-D'))).toBe(false)
  })

  test('/workflow delete keeps a lane whose branch is not merged, or that has changes, and names both', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building, 3 building]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    laneWithTest(fake, LANE_3, 3)
    fake.unmerged.add('feat/login-s1')
    fake.lanes.set(LANE_3, { branch: 'feat/login-s3', porcelain: '?? notes.txt\n' })
    fake.answers.push(DELETE.yes)
    await start($)

    const ran = await run($, 'delete login')

    expect(fake.gitRuns.some(found => found.line.startsWith('worktree remove'))).toBe(false)
    expect(ran.text).toContain(`${LANE_1} (feat/login-s1 is not merged into feat/login)`)
    expect(ran.text).toContain(`${LANE_3} (uncommitted changes)`)
    expect(ran.text).toContain('by hand')
  })

  test("/workflow delete deletes every lane's lock, runs and tree index with the record", async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building, 3 building]' }), 'feat/login')
    fake.answers.push(DELETE.yes)
    await start($)

    await run($, 'delete login')

    expect(fake.rmRuns.at(-1)).toEqual(
      expect.arrayContaining([
        `${STATE_DIR}/locks/lanes/login/1.json`,
        `${STATE_DIR}/runs/lanes/login/1.json`,
        `${STATE_DIR}/lanes/login/1.index`,
        `${STATE_DIR}/locks/lanes/login/3.json`,
      ]),
    )
  })

  test('cancelling the delete removes no lane', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 verified]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    fake.answers.push(DELETE.no)
    await start($)

    await run($, 'delete login')

    expect(fake.gitRuns.some(found => found.line.startsWith('worktree remove'))).toBe(false)
  })

  test('the closing gate removes a lane left clean and merged, and says so', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ phase: 'inspect', lanes: '[1 verified]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    fake.answers.push(GATE.continue)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['The pull request is open.'] })

    expect(gitIn(fake, ROOT)).toContain(`worktree remove ${LANE_1}`)
    expect(text(ran)).toContain(`Removed the lane worktree ${LANE_1}`)
    expect(state(fake).lanes).toEqual([])
  })
})

describe('spawns sent in one message', () => {
  test('take no more lanes than are free', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)
    await spawn($, buildTask('login', 1))
    await spawn($, buildTask('login', 3))

    const ran = await Promise.all([spawn($, buildTask('login', 4)), spawn($, buildTask('login', 5))])

    expect(ran.filter(spawn => spawn.deny !== undefined)).toHaveLength(1)
    expect(state(fake).lanes).toHaveLength(3)
  })

  test('take one lane for one slice named twice', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)

    const ran = await Promise.all([spawn($, buildTask('login', 1)), spawn($, buildTask('login', 1))])

    expect(ran.filter(spawn => spawn.deny !== undefined)).toHaveLength(1)
    expect(state(fake).lanes).toHaveLength(1)
    expect(fake.spawns).toHaveLength(1)
  })
})

describe('a lane git cannot create', () => {
  test('is refused with the reason, and leaves no lane in the state', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    fake.worktreeAddExit = 128
    await start($)

    const ran = await spawn($, buildTask('login', 1))

    expect(ran.deny).toContain('git could not create the worktree')
    expect(state(fake).lanes).toEqual([])
  })
})

describe('a merge that fails half way', () => {
  test('reaches the conversation instead of waiting in silence', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    const lock = `${STATE_DIR}/locks/lanes/login/1.json`
    fake.files.set(lock, (fake.files.get(lock) ?? '').replace('"green"', '"open"'))

    await agentEnds($, fake, 'agent-1')

    expect(fake.prompts).toHaveLength(1)
    expect(fake.prompts[0]).toContain('could not merge the lane of slice 1')
  })
})

const REMEMBER_RED = 'pnpm vitest run src/remember.test.ts'

// Slices 1 and 3 each locked and verified in their lane, slice 3 with the test file `slice3Test` holds.
async function twoVerifiedLanes($: Engine, fake: Fake, slice3Test: { file: string; text: string; red: string }): Promise<void> {
  await start($)
  await spawn($, buildTask('login', 1))
  await spawn($, buildTask('login', 3))
  fake.files.set(`${LANE_1}/src/cart.test.ts`, CART_TEST)
  fake.files.set(`${LANE_3}/${slice3Test.file}`, slice3Test.text)
  await lockInLane($, fake, LANE_1, 'agent-1')
  await lockInLane($, fake, LANE_3, 'agent-2', slice3Test.red)
  await verifyInLane($, fake, LANE_1, 'agent-1')
  await verifyInLane($, fake, LANE_3, 'agent-2', slice3Test.red)
}

describe('two lanes that end at the same time', () => {
  test('both merge: each slice ticked, each test locked, no merge aborted', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await twoVerifiedLanes($, fake, { file: 'src/remember.test.ts', text: "it('remembers', () => expect(remember()).toBe(true))\n", red: REMEMBER_RED })

    await Promise.all([agentEnds($, fake, 'agent-1'), agentEnds($, fake, 'agent-2')])

    expect(fake.files.get(SLICES_FILE)).toContain('## Slice 1: Walking skeleton\n- [x] Done')
    expect(fake.files.get(SLICES_FILE)).toContain('## Slice 3: Remember me\n- [x] Done')
    expect(Object.keys(JSON.parse(fake.files.get(`${STATE_DIR}/locks/login.json`) ?? '{}').files ?? {})).toEqual(
      expect.arrayContaining(['src/cart.test.ts', 'src/remember.test.ts']),
    )
    expect(state(fake).lanes).toEqual([])
    expect(gitIn(fake, ROOT)).not.toContain('merge --abort')
  })
})

const LANE_4 = `${ROOT}-s4`
const FEATURE_TIP = 'c9'
const IMPORT = "import { total } from './cart'"
const FIRST = "it('totals', () => expect(total([10, 20])).toBe(30))"
const SECOND = "it('totals nothing', () => expect(total([])).toBe(0))"
const CASE_3 = "it('totals one', () => expect(total([5])).toBe(5))"
const CASE_4 = "it('totals negatives', () => expect(total([-1])).toBe(-1))"
const OTHER_4 = "it('totals twice', () => expect(total([5, 5])).toBe(10))"

function file(...lines: string[]): string {
  return `${lines.join('\n')}\n`
}

const CART_BASE = file(IMPORT, '', FIRST, '', SECOND)
// Lane 3 adds a case after the first one, lane 4 one at the end: git merges the two hunks cleanly.
const CART_3 = file(IMPORT, '', FIRST, CASE_3, '', SECOND)
const CART_4 = file(IMPORT, '', FIRST, '', SECOND, CASE_4)
const CART_BOTH = file(IMPORT, '', FIRST, CASE_3, '', SECOND, CASE_4)
// Lane 4 adds its case where lane 3 added one: git conflicts inside the locked test.
const CART_4_SAME_PLACE = file(IMPORT, '', FIRST, OTHER_4, '', SECOND)

// Slice 1 merged with the shared test file, which the workflow lock then holds; slices 3 and 4 start from it.
async function sharedTestLocked($: Engine, fake: Fake): Promise<void> {
  await start($)
  await spawn($, buildTask('login', 1))
  fake.files.set(`${LANE_1}/src/cart.test.ts`, CART_BASE)
  await lockInLane($, fake, LANE_1, 'agent-1')
  await verifyInLane($, fake, LANE_1, 'agent-1')
  await agentEnds($, fake, 'agent-1')
  await spawn($, buildTask('login', 3))
  await spawn($, buildTask('login', 4))
}

async function laneExtends($: Engine, fake: Fake, path: string, agentId: string, text: string): Promise<void> {
  fake.files.set(`${path}/src/cart.test.ts`, text)
  await lockInLane($, fake, path, agentId)
  await verifyInLane($, fake, path, agentId)
}

function mergingWorkflow(fake: Fake, path: string): void {
  fake.refs.set('refs/heads/feat/login', FEATURE_TIP)
  const lane = fake.lanes.get(path)
  if (lane !== undefined) lane.mergeHead = FEATURE_TIP
}

async function shell($: Engine, fake: Fake, path: string, agentId: string, command: string, writes: Record<string, string>): Promise<string[]> {
  fake.shellWrites.set(command, writes)
  let notes: string[] = []
  await inLane(fake, path, async () => {
    fake.bash.set(command, 0)
    notes = [...((await $.tool.call({ tool: 'Bash', command, agentId })).context ?? [])]
  })
  return notes
}

describe('a locked test that two lanes extend in different hunks', () => {
  test('both lanes merge, and the file and the lock hold both cases', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await sharedTestLocked($, fake)
    await laneExtends($, fake, LANE_3, 'agent-2', CART_3)
    await laneExtends($, fake, LANE_4, 'agent-3', CART_4)

    await agentEnds($, fake, 'agent-2')
    await agentEnds($, fake, 'agent-3')

    expect(fake.files.get(`${ROOT}/src/cart.test.ts`)).toBe(CART_BOTH)
    expect(JSON.parse(fake.files.get(`${STATE_DIR}/locks/login.json`) ?? '{}')).toMatchObject({ files: { 'src/cart.test.ts': { content: CART_BOTH } } })
    expect(state(fake).lanes).toEqual([])
  })

  test('a merge that would drop a line of the locked test is aborted, and the lane kept for its resolution', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await sharedTestLocked($, fake)
    await laneExtends($, fake, LANE_3, 'agent-2', CART_3)
    fake.files.set(`${LANE_3}/src/cart.test.ts`, file(IMPORT, '', FIRST, CASE_3, ''))

    await agentEnds($, fake, 'agent-2')

    expect(gitIn(fake, ROOT)).toContain('merge --abort')
    expect(state(fake).lanes.find(lane => lane.slice === 3)).toMatchObject({ verified: false })
    expect(fake.prompts.at(-1)).toContain(SECOND)
    expect(fake.prompts.at(-1)).toContain(resolveTask('login', 3))
  })

  test('the clean merge of the workflow branch into a lane keeps the locked test as git merged it', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await sharedTestLocked($, fake)
    fake.files.set(`${LANE_3}/src/cart.ts`, 'export const total = (items: number[]) => items.reduce((a, b) => a + b, 0)\n')
    fake.files.set(`${LANE_4}/src/cart.ts`, 'export const total = (items: number[]) => items.reduce((sum, item) => sum + item, 0)\n')
    await laneExtends($, fake, LANE_3, 'agent-2', CART_3)
    await laneExtends($, fake, LANE_4, 'agent-3', CART_4)
    await agentEnds($, fake, 'agent-2')
    await agentEnds($, fake, 'agent-3')
    await spawn($, resolveTask('login', 4))
    mergingWorkflow(fake, LANE_4)

    const notes = await shell($, fake, LANE_4, 'agent-4', 'git merge feat/login', {
      [`${LANE_4}/src/cart.test.ts`]: CART_BOTH,
      [`${LANE_4}/src/cart.ts`]: 'export const total = (items: number[]) => items.reduce((a, b) => a + b, 0)\n',
    })
    laneMergedWorkflow(fake, LANE_4)
    const kept = fake.files.get(`${LANE_4}/src/cart.test.ts`)
    await verifyInLane($, fake, LANE_4, 'agent-4')
    await agentEnds($, fake, 'agent-4')

    expect(notes).toEqual([])
    expect(kept).toBe(CART_BOTH)
    expect(fake.files.get(`${ROOT}/src/cart.test.ts`)).toBe(CART_BOTH)
    expect(state(fake).lanes).toEqual([])
  })

  test('a conflict inside the locked test is restored, the agent is told to stop, and the merge stays refused', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await sharedTestLocked($, fake)
    await laneExtends($, fake, LANE_3, 'agent-2', CART_3)
    await laneExtends($, fake, LANE_4, 'agent-3', CART_4_SAME_PLACE)
    await agentEnds($, fake, 'agent-2')
    await agentEnds($, fake, 'agent-3')
    await spawn($, resolveTask('login', 4))
    mergingWorkflow(fake, LANE_4)

    const notes = await shell($, fake, LANE_4, 'agent-4', 'git merge feat/login', {
      [`${LANE_4}/src/cart.test.ts`]: file(IMPORT, '', FIRST, '<<<<<<< HEAD', OTHER_4, '=======', CASE_3, '>>>>>>> feat/login', '', SECOND),
    })
    const restored = fake.files.get(`${LANE_4}/src/cart.test.ts`)
    await verifyInLane($, fake, LANE_4, 'agent-4')
    await agentEnds($, fake, 'agent-4')

    expect(restored).toBe(CART_4_SAME_PLACE)
    expect(notes.join('\n')).toContain('put the conflict to the user')
    expect(gitIn(fake, ROOT).filter(line => line === 'merge --abort')).toHaveLength(2)
    expect(state(fake).lanes.find(lane => lane.slice === 4)).toMatchObject({ verified: false })
  })
})

describe('a locked test changed in a lane, outside a merge of the workflow branch', () => {
  async function extendedInLane3($: Engine, fake: Fake): Promise<void> {
    await sharedTestLocked($, fake)
    fake.files.set(`${LANE_3}/src/cart.test.ts`, CART_3)
    await lockInLane($, fake, LANE_3, 'agent-2')
  }

  test('an import swapped for a stub is restored, even while merging', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await extendedInLane3($, fake)
    mergingWorkflow(fake, LANE_3)

    await shell($, fake, LANE_3, 'agent-2', "sed -i s/cart/stub/ src/cart.test.ts", {
      [`${LANE_3}/src/cart.test.ts`]: file("import { total } from './stub'", '', FIRST, CASE_3, '', SECOND),
    })

    expect(fake.files.get(`${LANE_3}/src/cart.test.ts`)).toBe(CART_3)
  })

  test('an expect moved out of its order is restored, even while merging', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await extendedInLane3($, fake)
    mergingWorkflow(fake, LANE_3)

    await shell($, fake, LANE_3, 'agent-2', 'reorder', { [`${LANE_3}/src/cart.test.ts`]: file(IMPORT, '', CASE_3, FIRST, '', SECOND) })

    expect(fake.files.get(`${LANE_3}/src/cart.test.ts`)).toBe(CART_3)
  })

  test('a duplicated line is restored, even while merging', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await extendedInLane3($, fake)
    mergingWorkflow(fake, LANE_3)

    await shell($, fake, LANE_3, 'agent-2', 'duplicate', { [`${LANE_3}/src/cart.test.ts`]: file(IMPORT, '', FIRST, FIRST, CASE_3, '', SECOND) })

    expect(fake.files.get(`${LANE_3}/src/cart.test.ts`)).toBe(CART_3)
  })

  test('even the content git would merge is restored when the lane is not merging the workflow branch', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await extendedInLane3($, fake)
    await laneExtends($, fake, LANE_4, 'agent-3', CART_4)
    await agentEnds($, fake, 'agent-3')

    await shell($, fake, LANE_3, 'agent-2', 'cp merged src/cart.test.ts', { [`${LANE_3}/src/cart.test.ts`]: CART_BOTH })

    expect(fake.files.get(`${LANE_3}/src/cart.test.ts`)).toBe(CART_3)
  })
})

describe('a hand-over during a dialog of the mod', () => {
  test('waits for the end of the main turn, though the band says waiting for you while the dialog is open', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    await $.prompt.submit({ text: 'Go on.', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: 'Go on.', turnId: 'main-1' })
    const before = fake.prompts.length
    fake.onAsk = async () => {
      fake.onAsk = undefined
      await agentEnds($, fake, 'agent-1')
    }
    fake.answers.push(UNLOCK.no)

    await $.tool.call({ tool: 'mcp__workflow__unlock', file: 'src/cart.test.ts', reason: 'the spec says 31' })
    await fake.clock.settle()
    const during = fake.prompts.length
    await agentEnds($, fake, undefined)

    expect(during).toBe(before)
    expect(fake.prompts).toHaveLength(before + 1)
  })
})

describe('a slice locked in the workflow worktree before lanes', () => {
  test('finishes there, then the next slices start in lanes', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ commits: 'no' }, { [`${ROOT}/src/cart.test.ts`]: CART_TEST, [`${ROOT}/src/cart.ts`]: 'export const total = () => 30\n' }), 'feat/login')
    await start($)
    fake.bash.set(RED, 1)
    await $.tool.call({ tool: 'Bash', command: RED })
    await $.tool.call({ tool: 'mcp__workflow__lock' })
    fake.files.set(STATE_FILE, stateText({ commits: 'yes' }))

    await spawn($, buildTask('login', 1))
    const inWorktree = spawned(fake)?.cwd
    for (const command of GREEN) {
      fake.bash.set(command, 0)
      await $.tool.call({ tool: 'Bash', command })
    }
    const verified = text(await $.tool.call({ tool: 'mcp__workflow__verify', agentId: 'agent-1' }))
    await spawn($, buildTask('login', 3))

    expect(inWorktree).toBeUndefined()
    expect(verified).toContain('Slice 1 verified')
    expect(spawned(fake)?.cwd).toBe(LANE_3)
  })
})

describe('the files of a lane', () => {
  test("never touch those of a workflow whose name ends like a lane's", async ($, on) => {
    const other = `${STATE_DIR}/locks/login-s1.json`
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building]' }, { [other]: '{"kept": true}' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    await start($)

    await lockInLane($, fake, LANE_1, 'agent-1')

    expect(fake.files.get(other)).toBe('{"kept": true}')
    expect(fake.files.has(`${STATE_DIR}/locks/lanes/login/1.json`)).toBe(true)
  })
})

describe('an agent that no longer runs', () => {
  test('does not keep its lane from being spawned again', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)
    await spawn($, buildTask('login', 1))
    fake.agentStatus.set('agent-1', 'completed')

    const ran = await spawn($, buildTask('login', 1))

    expect(ran.deny).toBeUndefined()
    expect(spawned(fake)?.cwd).toBe(LANE_1)
  })

  test('two spawns of one existing lane in one message start one agent', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    await start($)

    const ran = await Promise.all([spawn($, buildTask('login', 1)), spawn($, buildTask('login', 1))])

    expect(ran.filter(spawn => spawn.deny !== undefined)).toHaveLength(1)
    expect(fake.spawns).toHaveLength(1)
  })

  test('the end of an earlier agent merges nothing while another agent works in the lane', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    fake.agentStatus.set('agent-1', 'completed')
    await spawn($, buildTask('login', 1))

    await agentEnds($, fake, 'agent-1')

    expect(fake.gitRuns.some(found => found.line.startsWith('merge'))).toBe(false)
    expect(state(fake).lanes).toHaveLength(1)
  })
})

describe('a merge git refuses to start', () => {
  test('aborts nothing, and keeps the lane for its resolution', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    fake.mergeExit = 1
    fake.conflictLeavesHead = false

    await agentEnds($, fake, 'agent-1')

    expect(gitIn(fake, ROOT)).not.toContain('merge --abort')
    expect(state(fake).lanes).toEqual([{ slice: 1, branch: 'feat/login-s1', worktree: LANE_1, verified: false }])
    expect(fake.prompts[0]).toContain(resolveTask('login', 1))
  })
})

describe('the list of workflows everywhere', () => {
  test('names the workflow by its worktree, not by a lane that saved its state', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    await start($)
    await lockInLane($, fake, LANE_1, 'agent-1')

    const listed = await run($, 'all')

    expect(listed.text).not.toContain(LANE_1)
    expect(listed.text).toContain(`${ROOT}: login`)
  })
})

describe("a dirty workflow worktree at a lane's end", () => {
  test('keeps the lane verified, names the dirty files and asks for no new build', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    fake.porcelain = ' M README.md\n'

    await agentEnds($, fake, 'agent-1')

    expect(state(fake).lanes).toEqual([{ slice: 1, branch: 'feat/login-s1', worktree: LANE_1, verified: true }])
    expect(fake.prompts[0]).toContain('README.md')
    expect(fake.prompts[0]).not.toContain(`"${buildTask('login', 1)}"`)
  })

  test('the next lane end merges the waiting lane once the worktree is clean', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await twoVerifiedLanes($, fake, { file: 'src/remember.test.ts', text: "it('remembers', () => expect(remember()).toBe(true))\n", red: REMEMBER_RED })
    fake.porcelain = ' M README.md\n'
    await agentEnds($, fake, 'agent-1')
    fake.porcelain = ''

    await agentEnds($, fake, 'agent-2')

    expect(fake.files.get(SLICES_FILE)).toContain('## Slice 1: Walking skeleton\n- [x] Done')
    expect(fake.files.get(SLICES_FILE)).toContain('## Slice 3: Remember me\n- [x] Done')
  })

  test('/workflow continue merges the waiting lane once the worktree is clean', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    fake.porcelain = ' M README.md\n'
    await agentEnds($, fake, 'agent-1')
    fake.porcelain = ''

    await run($, 'continue')
    await fake.clock.settle()

    expect(fake.files.get(SLICES_FILE)).toContain('## Slice 1: Walking skeleton\n- [x] Done')
    expect(state(fake).lanes).toEqual([])
  })
})

describe('/workflow continue while a lane agent runs', () => {
  test('does not ask to spawn that lane again', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)
    await spawn($, buildTask('login', 1))

    await run($, 'continue')
    await fake.clock.settle()

    expect(fake.prompts[0]).not.toContain(`- "${buildTask('login', 1)}"`)
    expect(fake.prompts[0]).toContain(`- "${buildTask('login', 3)}"`)
  })
})

describe('the documents of a workflow that commits nothing', () => {
  test("are read from the session's checkout, not from the worktree the state names", async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ worktree: '/elsewhere' }) }), 'feat/login')
    await start($)

    await run($, 'continue')
    await fake.clock.settle()

    expect(fake.prompts[0]).toContain('Slice 1: Walking skeleton')
  })
})

describe('a cancelled /workflow delete', () => {
  test('leaves the lanes as they were', async ($, on) => {
    const worktree = `${ROOT}-login`
    const fake = laneEngine(on, laneRepo({ worktree, lanes: '[1 verified]' }, { [`${worktree}/.git`]: `gitdir: ${ROOT}/.git/worktrees/x\n` }), 'feat/login')
    laneWithTest(fake, `${worktree}-s1`, 1)
    fake.answers.push(DELETE.yes, DELETE.cancel)
    await start($)

    await run($, 'delete login')

    expect(fake.gitRuns.some(found => found.line.startsWith('worktree remove'))).toBe(false)
    expect(state(fake).lanes).toHaveLength(1)
  })
})

describe('an unlock the user approved', () => {
  test('in a lane, lets the merge of the changed line through and moves it into the workflow lock', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await sharedTestLocked($, fake)
    fake.files.set(`${LANE_3}/src/remember.test.ts`, "it('remembers', () => expect(remember()).toBe(true))\n")
    await lockInLane($, fake, LANE_3, 'agent-2', REMEMBER_RED)
    fake.answers.push(UNLOCK.yes)
    await $.tool.call({ tool: 'mcp__workflow__unlock', file: 'src/cart.test.ts', reason: 'the spec says 31' })
    const changed = CART_BASE.replace('toBe(30)', 'toBe(31)')
    fake.cwd = LANE_3
    await $.tool.call({ tool: 'Write', file_path: `${LANE_3}/src/cart.test.ts`, content: changed, agentId: 'agent-2' })
    fake.cwd = ROOT
    await verifyInLane($, fake, LANE_3, 'agent-2', REMEMBER_RED)

    await agentEnds($, fake, 'agent-2')

    expect(fake.files.get(`${ROOT}/src/cart.test.ts`)).toBe(changed)
    expect(JSON.parse(fake.files.get(`${STATE_DIR}/locks/login.json`) ?? '{}')).toMatchObject({ files: { 'src/cart.test.ts': { content: changed } }, unlocked: [] })
    expect(state(fake).lanes.map(lane => lane.slice)).toEqual([4])
  })

  test("in the workflow's worktree, lets an integration fix change a locked line, folded into the lock at the next merge", async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await sharedTestLocked($, fake)
    fake.answers.push(UNLOCK.yes)
    await $.tool.call({ tool: 'mcp__workflow__unlock', file: 'src/cart.test.ts', reason: 'two slices broke the total together' })
    const fixed = CART_BASE.replace('toBe(30)', 'toBe(31)')
    fake.files.set(`${ROOT}/src/cart.test.ts`, fixed)
    fake.files.set(`${LANE_3}/src/remember.test.ts`, "it('remembers', () => expect(remember()).toBe(true))\n")
    await lockInLane($, fake, LANE_3, 'agent-2', REMEMBER_RED)
    await verifyInLane($, fake, LANE_3, 'agent-2', REMEMBER_RED)

    await agentEnds($, fake, 'agent-2')

    expect(state(fake).lanes.map(lane => lane.slice)).toEqual([4])
    expect(JSON.parse(fake.files.get(`${STATE_DIR}/locks/login.json`) ?? '{}')).toMatchObject({ files: { 'src/cart.test.ts': { content: fixed } }, unlocked: [] })
  })
})

describe('the conversation between turns', () => {
  test('a turn a command started holds the hand-over until it ends', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    await $.turn.start({ text: '/simplify', turnId: 'command-1' })

    await agentEnds($, fake, 'agent-1')
    const during = fake.prompts.length
    await agentEnds($, fake, undefined)

    expect(during).toBe(0)
    expect(fake.prompts).toHaveLength(1)
  })

  test('a turn started without a typed prompt holds the hand-over until it ends', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    await $.turn.start({ text: '', turnId: 'continued-1' })

    await agentEnds($, fake, 'agent-1')
    const during = fake.prompts.length
    await agentEnds($, fake, undefined)

    expect(during).toBe(0)
    expect(fake.prompts).toHaveLength(1)
  })

  test('a prompt delivered into the running turn does not hold the hand-over past the end of that turn', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    await $.turn.start({ text: 'Go on.', turnId: 'main-1' })
    await $.prompt.submit({ text: 'And the logout?', wait: false, turnId: 'main-1', origin: { kind: 'composer' } })
    const before = fake.prompts.length

    await agentEnds($, fake, 'agent-1')
    await agentEnds($, fake, undefined)

    expect(fake.prompts).toHaveLength(before + 1)
  })

  test('a turn that starts right after the end of one defers the hand-over to its own end', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedLane($, fake)
    await $.turn.start({ text: 'Go on.', turnId: 'main-1' })
    await agentEnds($, fake, 'agent-1')

    await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 'main-1', reason: 'answer' })
    await $.turn.start({ text: 'And the logout?', turnId: 'main-2' })
    await fake.clock.settle()
    const during = fake.prompts.length
    await agentEnds($, fake, undefined)

    expect(during).toBe(0)
    expect(fake.prompts).toHaveLength(1)
  })
})

describe('/workflow delete with the worktree removal accepted', () => {
  test('removes the merged clean lanes before the workflow worktree', async ($, on) => {
    const worktree = `${ROOT}-login`
    const fake = laneEngine(on, laneRepo({ worktree, lanes: '[1 verified]' }, { [`${worktree}/.git`]: `gitdir: ${ROOT}/.git/worktrees/x\n` }), 'feat/login')
    laneWithTest(fake, `${worktree}-s1`, 1)
    fake.ignoredListing = ''
    fake.unpushed = ''
    for (const ref of ['feat/login', 'refs/heads/feat/login', 'feat/login@{u}']) fake.refs.set(ref, 'c1')
    fake.answers.push(DELETE.yes, ENDING.remove)
    await start($)

    await run($, 'delete login')

    const removals = fake.gitRuns.filter(found => found.line.startsWith('worktree remove')).map(found => found.line)
    expect(removals).toEqual([`worktree remove ${worktree}-s1`, `worktree remove ${worktree}`])
    expect(fake.gitRuns.map(found => found.line)).toContain('branch -d feat/login-s1')
  })
})

describe('the name of a lane file', () => {
  test('refuses a slug that is not a plain file name', () => {
    expect(() => laneKey('../login', 1)).toThrow('plain file name')
  })

  test('refuses a slice that is not a positive whole number', () => {
    expect(() => laneKey('login', 0)).toThrow('slice')
  })
})

// A reload keeps $.state: these hooks stand for the lane agents the module kept before it.
function heldLaneAgents(on: On, agents: Record<string, unknown>): void {
  let held: { value: unknown; version: number } = { value: { shape: 'lane-agents-1', value: agents }, version: 1 }
  on('state.get', { plugin: 'workflow', key: 'laneAgents' }, () => ({ value: held }))
  on('state.set', { plugin: 'workflow', key: 'laneAgents' }, (_, e) => {
    if (e.ifVersion !== undefined && e.ifVersion !== held.version) return { value: { isSet: false, version: held.version } }
    held = { value: e.value, version: held.version + 1 }
    return { value: { isSet: true, version: held.version } }
  })
}

describe('a lane reserved for an agent that never started', () => {
  test('stops holding the slice once the reservation is stale', async ($, on) => {
    heldLaneAgents(on, { 'reserved:login:1': { slug: 'login', slice: 1, reservedAt: NOW - 10 * 60_000 } })
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)

    const ran = await spawn($, buildTask('login', 1))

    expect(ran.deny).toBeUndefined()
    expect(spawned(fake)?.cwd).toBe(LANE_1)
  })

  test('still holds it while the reservation is fresh', async ($, on) => {
    heldLaneAgents(on, { 'reserved:login:1': { slug: 'login', slice: 1, reservedAt: NOW } })
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await start($)

    const ran = await spawn($, buildTask('login', 1))

    expect(ran.deny).toContain('builds already')
    expect(fake.spawns).toHaveLength(0)
  })
})

const UNREADABLE = LANE_SLICES.replace('Depends on: Slice 1', 'Depends on: the login slice')

describe('no slice ready and no lane running', () => {
  test('the build prompt names what is wrong in slices.md', async ($, on) => {
    const fake = laneEngine(on, laneRepo({}, { [SLICES_FILE]: LANE_SLICES.replaceAll('Depends on: none', 'Depends on: Slice 2') }), 'feat/login')
    await start($)

    await run($, 'continue')
    await fake.clock.settle()

    expect(fake.prompts[0]).toContain('depend on each other in a cycle')
    expect(fake.prompts[0]).not.toContain('wait for the running lanes')
  })

  test('after a merge, the next step names what is wrong in slices.md and the workflow stays active', async ($, on) => {
    const onlyTwo = UNREADABLE.slice(0, UNREADABLE.indexOf('## Slice 3'))
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }, { [SLICES_FILE]: onlyTwo }), 'feat/login')
    await verifiedLane($, fake)

    await agentEnds($, fake, 'agent-1')

    expect(fake.prompts[0]).toContain('the login slice')
    expect(fake.prompts[0]).not.toContain('The user starts no new slice')
    expect(state(fake).status).toBe('active')
  })
})

const LOGOUT_RED = 'pnpm vitest run src/logout.test.ts'
const REMEMBER_TEST = "it('remembers', () => expect(remember()).toBe(true))\n"

// Lane 4 merges a test of its own after lane 3 was made: lane 3's worktree never had it.
async function laterLaneMerged($: Engine, fake: Fake): Promise<void> {
  await sharedTestLocked($, fake)
  fake.files.set(`${LANE_4}/src/logout.test.ts`, "it('logs out', () => expect(logout()).toBe(true))\n")
  await lockInLane($, fake, LANE_4, 'agent-3', LOGOUT_RED)
  await verifyInLane($, fake, LANE_4, 'agent-3', LOGOUT_RED)
  await agentEnds($, fake, 'agent-3')
}

describe("a lane's first lock after another lane merged", () => {
  test('is not refused for the tests the other lane merged, which its worktree never had', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await laterLaneMerged($, fake)
    fake.files.set(`${LANE_3}/src/remember.test.ts`, REMEMBER_TEST)

    const locked = await lockInLane($, fake, LANE_3, 'agent-2', REMEMBER_RED)

    expect(locked).toContain('Locked 1 test file for slice 3')
  })

  test('still refuses a line removed from a locked test the lane had', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ auto_next: 'yes' }), 'feat/login')
    await laterLaneMerged($, fake)
    fake.files.set(`${LANE_3}/src/remember.test.ts`, REMEMBER_TEST)
    fake.files.set(`${LANE_3}/src/cart.test.ts`, file(IMPORT, '', FIRST, ''))

    const locked = await lockInLane($, fake, LANE_3, 'agent-2', 'pnpm vitest run src/cart.test.ts src/remember.test.ts')

    expect(locked).toContain(SECOND)
    expect(locked).not.toContain('logs out')
  })
})

describe('git merge-file on a locked test', () => {
  test('gets inputs of its own at each call, and merges with the histogram algorithm', async ($, on) => {
    const fake = laneEngine(on, laneRepo(), 'feat/login')
    await sharedTestLocked($, fake)
    fake.files.set(`${LANE_3}/src/cart.test.ts`, CART_3)
    await lockInLane($, fake, LANE_3, 'agent-2')
    mergingWorkflow(fake, LANE_3)

    await shell($, fake, LANE_3, 'agent-2', 'first', { [`${LANE_3}/src/cart.test.ts`]: file(IMPORT, '', CASE_3, FIRST, '', SECOND) })
    await shell($, fake, LANE_3, 'agent-2', 'second', { [`${LANE_3}/src/cart.test.ts`]: file(IMPORT, '', FIRST, FIRST, CASE_3, '', SECOND) })

    const calls = fake.gitRuns.filter(found => found.line.startsWith('merge-file')).map(found => found.line)
    expect(calls).toHaveLength(2)
    expect(calls.every(line => line.includes('--diff-algorithm=histogram'))).toBe(true)
    expect(calls[0]?.split(' -- ')[1]).not.toBe(calls[1]?.split(' -- ')[1])
  })

  test('the resolve prompt says a locked test merged otherwise than git merge-file is restored', async ($, on) => {
    const fake = laneEngine(on, laneRepo({ lanes: '[1 building]' }), 'feat/login')
    laneWithTest(fake, LANE_1, 1)
    await start($)

    await spawn($, resolveTask('login', 1))

    expect(spawned(fake)?.prompt).toContain('merged differently from `git merge-file`')
  })
})
