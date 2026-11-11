import type { AgentSpec } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE, NEXT_SLICE } from '../src/labels'
import { parseWorkflow } from '../src/state'
import { ROOT, STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'
import type { Fake } from './engine'

const STATE_FILE = `${STATE_DIR}/login.md`
const DESIGN = buildRepo({ [STATE_FILE]: stateText({ phase: 'design', slice: '0' }) })
const TEST_FILE = `${ROOT}/src/cart.test.ts`
const RED = 'pnpm vitest run src/cart.test.ts'
const CHECKS = [RED, 'pnpm lint', 'pnpm tsc --noEmit', 'pnpm test']

function withoutConfig(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => path !== `${ROOT}/.claude/workflow.json`))
}

function agent(fake: Fake, name: string): AgentSpec | undefined {
  return fake.agents.filter(spec => spec.name === name).at(-1)
}

function plans(fake: Fake): Record<string, string> {
  return Object.fromEntries(fake.agents.map(spec => [spec.name, `${spec.model} ${spec.effort}`]))
}

function lastSection(prompt: string): string {
  return prompt.split('\n## ').at(-1) ?? ''
}

function text(ran: { deny?: string; result?: unknown }): string {
  return ran.deny ?? String(ran.result)
}

async function promptOf($: Engine, fake: Fake): Promise<string> {
  await run($, 'continue')
  await fake.clock.settle()
  return fake.prompts[0] ?? ''
}

async function verifiedByAgent($: Engine, fake: Fake): Promise<string> {
  await start($)
  fake.bash.set(RED, 1)
  await $.tool.call({ tool: 'Bash', command: RED })
  await $.tool.call({ tool: 'mcp__workflow__lock', agentId: 'a1' })
  for (const command of CHECKS) {
    fake.bash.set(command, 0)
    await $.tool.call({ tool: 'Bash', command })
  }
  return text(await $.tool.call({ tool: 'mcp__workflow__verify', agentId: 'a1' }))
}

async function agentEnds($: Engine, fake: Fake, agentId: string | undefined): Promise<void> {
  await $.turn.complete({ answer: 'Slice 1 built.', durationMs: 1, isAborted: false, turnId: `t-${agentId}`, reason: 'answer', agentId })
  await fake.clock.settle()
}

function sliceRepo(fields: Partial<Record<string, string>> = {}): Record<string, string> {
  return buildRepo({ [TEST_FILE]: "it('totals', () => expect(total()).toBe(30))\n", [STATE_FILE]: stateText(fields) })
}

describe('one agent per step', () => {
  test('a feature registers map, design, slice, review and build, each on its plan model and effort', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')

    await start($)

    expect(plans(fake)).toEqual({
      map: 'sonnet medium',
      design: 'opus high',
      slice: 'opus high',
      review: 'opus high',
      build: 'opus medium',
    })
  })

  test('a project without workflow.json registers setup and spec, and no map', async ($, on) => {
    const fake = fakeEngine(on, withoutConfig(buildRepo({ [STATE_FILE]: stateText({ size: 'project', phase: 'setup', slice: '0' }) })), 'feat/login')

    await start($)

    expect(Object.keys(plans(fake)).sort()).toEqual(['build', 'design', 'review', 'setup', 'slice', 'spec'])
  })

  test('the plan of the state file sets each agent its model and effort', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'design', slice: '0', models: '[design sonnet low, review haiku medium]' }) }), 'feat/login')

    await start($)

    expect(plans(fake)).toMatchObject({ design: 'sonnet low', review: 'haiku medium' })
  })

  test('every agent has mcp__workflow__unlock withheld', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')

    await start($)

    expect(fake.agents.length).toBeGreaterThan(0)
    expect(fake.agents.every(spec => spec.disallowedTools?.includes('mcp__workflow__unlock'))).toBe(true)
  })
})

describe('workflow:review', () => {
  test('may only read, search and run commands', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')

    await start($)

    expect(agent(fake, 'review')?.tools).toEqual(['Read', 'Grep', 'Glob', 'Bash'])
  })

  test("carries the reviewer agent's prompt without its frontmatter, then the inspect agent section", async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')

    await start($)

    const prompt = agent(fake, 'review')?.prompt ?? ''
    expect(prompt.startsWith('You review a change you did not write.')).toBe(true)
    expect(prompt).not.toContain('name: reviewer')
    expect(prompt).toContain('Work as the inspect agent.')
    expect(prompt).not.toContain('Do the inspect work.')
  })

  test('without agents/reviewer.md it is still registered, read-only, with a reviewing prompt', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.missing.push('/agents/reviewer.md')

    await start($)

    const review = agent(fake, 'review')
    expect(review?.tools).toEqual(['Read', 'Grep', 'Glob', 'Bash'])
    expect(review?.prompt).toContain('never edit a file')
    expect(review?.prompt).toContain('Work as the inspect agent.')
  })
})

describe('the phase prompt for the conversation', () => {
  test('holds the With the user section and not the Agent one', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    await start($)

    const prompt = await promptOf($, fake)

    expect(prompt).toContain('Do the design work.')
    expect(prompt).not.toContain('Work as the design agent.')
    expect(prompt).not.toContain('Map the project.')
  })

  test('names the agent to spawn, its model and its effort', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'design', slice: '0', models: '[design sonnet low]' }) }), 'feat/login')
    await start($)

    const prompt = await promptOf($, fake)

    expect(prompt).toEqual(expect.stringMatching(/`workflow:design`[^\n]*sonnet[^\n]*low/))
  })

  test('in the build phase names the slice and the agent, and leaves the slice text and checks to the agent', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')
    await start($)

    const prompt = await promptOf($, fake)

    expect(prompt).toContain('Slice 1: Walking skeleton')
    expect(prompt).toEqual(expect.stringMatching(/`workflow:build`[^\n]*opus[^\n]*medium/))
    expect(prompt).not.toContain('Goal: a form posts to a stub route.')
    expect(prompt).not.toContain('Form and route.')
    expect(prompt).not.toContain('`pnpm lint`')
  })

  test('in the intake names no agent: the intake stays in the conversation', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'intake', slice: '0' }) }), 'feat/login')
    await start($)

    const prompt = await promptOf($, fake)

    expect(prompt).toContain('The problem')
    expect(prompt).not.toContain('`workflow:')
  })

  test('in the retro names no agent: the retro stays in the conversation', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ size: 'project', phase: 'retro', slice: '0' }) }), 'feat/login')
    await start($)

    const prompt = await promptOf($, fake)

    expect(prompt).toContain('The retro phase')
    expect(prompt).not.toContain('`workflow:')
  })
})

describe("an agent's prompt", () => {
  test('holds its Agent section and the worker rules, ending with the report format', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')

    await start($)

    const prompt = agent(fake, 'design')?.prompt ?? ''
    expect(prompt).toContain('Work as the design agent.')
    expect(prompt).not.toContain('Do the design work.')
    expect(lastSection(prompt).startsWith('Report')).toBe(true)
  })

  test('of workflow:map holds the Map agent section of the design phase', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')

    await start($)

    const prompt = agent(fake, 'map')?.prompt ?? ''
    expect(prompt).toContain('Map the project.')
    expect(prompt).not.toContain('Work as the design agent.')
    expect(lastSection(prompt).startsWith('Report')).toBe(true)
  })
})

describe('the hand-over after a slice the build agent verified', () => {
  test('verify tells the agent to finish its report, and asks nothing', async ($, on) => {
    const fake = fakeEngine(on, sliceRepo(), 'feat/login')

    const verified = await verifiedByAgent($, fake)

    expect(verified).toContain('Slice 1 verified: ')
    expect(verified).toContain('finish your report')
    expect(verified).not.toContain('Spawn `workflow:build`')
    expect(fake.questions).toHaveLength(0)
  })

  test('with auto_next, the end of its run submits the spawn of the next slice', async ($, on) => {
    const fake = fakeEngine(on, sliceRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedByAgent($, fake)

    await agentEnds($, fake, 'a1')

    expect(fake.prompts).toHaveLength(1)
    expect(fake.prompts[0]).toEqual(expect.stringMatching(/Spawn `workflow:build`[^\n]*slice 2/))
    expect(fake.questions).toHaveLength(0)
  })

  test('without auto_next, the dialog comes once its run ends, and starting submits the next spawn', async ($, on) => {
    const fake = fakeEngine(on, sliceRepo(), 'feat/login')
    fake.answers.push(NEXT_SLICE.start(2))
    await verifiedByAgent($, fake)
    const asked = fake.questions.length

    await agentEnds($, fake, 'a1')

    expect(asked).toBe(0)
    expect(fake.questions).toEqual([NEXT_SLICE.question('login', 1)])
    expect(fake.prompts[0]).toEqual(expect.stringMatching(/Spawn `workflow:build`[^\n]*slice 2/))
  })

  test('without auto_next, stopping submits the handoff and the stop, naming /workflow continue', async ($, on) => {
    const fake = fakeEngine(on, sliceRepo(), 'feat/login')
    fake.answers.push(NEXT_SLICE.stop)
    await verifiedByAgent($, fake)

    await agentEnds($, fake, 'a1')

    expect(fake.prompts[0]).toContain('mcp__workflow__handoff')
    expect(fake.prompts[0]).toContain('/workflow continue login')
    expect(fake.prompts[0]).not.toContain('Spawn `workflow:build`')
  })

  test('after the last slice, the end of its run submits the inspect prompt', async ($, on) => {
    const fake = fakeEngine(on, sliceRepo({ slice: '2' }), 'feat/login')
    await verifiedByAgent($, fake)

    await agentEnds($, fake, 'a1')

    expect(fake.prompts[0]).toContain('inspect phase')
    expect(fake.prompts[0]).toContain('Do the inspect work.')
  })

  test('the end of another agent or of the main loop hands nothing over, and the hand-over happens once', async ($, on) => {
    const fake = fakeEngine(on, sliceRepo({ auto_next: 'yes' }), 'feat/login')
    await verifiedByAgent($, fake)

    await agentEnds($, fake, 'a2')
    await agentEnds($, fake, undefined)
    const before = fake.prompts.length
    await agentEnds($, fake, 'a1')
    await agentEnds($, fake, 'a1')

    expect(before).toBe(0)
    expect(fake.prompts).toHaveLength(1)
  })
})

describe('the tools a step agent cannot use', () => {
  test('unlock from a step agent is refused without asking', async ($, on) => {
    const fake = fakeEngine(on, sliceRepo(), 'feat/login')
    await start($)
    fake.bash.set(RED, 1)
    await $.tool.call({ tool: 'Bash', command: RED })
    await $.tool.call({ tool: 'mcp__workflow__lock' })

    const ran = await $.tool.call({ tool: 'mcp__workflow__unlock', file: 'src/cart.test.ts', reason: 'wrong', agentId: 'a1' })

    expect(ran.deny).toContain('only the conversation')
    expect(fake.questions).toHaveLength(0)
  })
})

describe('Stop here at a gate', () => {
  test('pauses the workflow, as /workflow pause does', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.stop)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B.' })

    expect(parseWorkflow(fake.files.get(STATE_FILE) ?? '')).toMatchObject({ phase: 'slice', status: 'paused' })
  })

  test('in the next-slice dialog pauses the workflow too', async ($, on) => {
    const fake = fakeEngine(on, sliceRepo(), 'feat/login')
    fake.answers.push(NEXT_SLICE.stop)
    await verifiedByAgent($, fake)

    await agentEnds($, fake, 'a1')

    expect(parseWorkflow(fake.files.get(STATE_FILE) ?? '')).toMatchObject({ phase: 'build', slice: 2, status: 'paused' })
  })
})
