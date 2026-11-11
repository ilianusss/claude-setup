import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { buildAgentSpec } from '../src/agents'
import { GATE, SWITCH } from '../src/labels'
import { ROOT, STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'
import type { Fake } from './engine'

const WITHHELD = ['mcp__workflow__advance', 'mcp__workflow__handoff', 'AskUserQuestion']
const TEST_FILE = `${ROOT}/src/cart.test.ts`
const RED = 'pnpm vitest run src/cart.test.ts'
const CHECKS = [RED, 'pnpm lint', 'pnpm tsc --noEmit', 'pnpm test']

function lastSection(prompt: string): string {
  return prompt.split('\n## ').at(-1) ?? ''
}

async function bash($: Engine, fake: Fake, command: string, exitCode: number): Promise<void> {
  fake.bash.set(command, exitCode)
  await $.tool.call({ tool: 'Bash', command })
}

describe('the agent spec', () => {
  test('carries the model and effort it is given', () => {
    const spec = buildAgentSpec('build', { model: 'haiku', effort: 'low' }, 'Do the build work.')

    expect(spec).toMatchObject({ name: 'build', model: 'haiku', effort: 'low' })
  })

  test('withholds the tools that move the workflow or ask the user', () => {
    const spec = buildAgentSpec('build', { model: 'opus', effort: 'medium' }, 'Do the build work.')

    expect(spec.disallowedTools).toEqual(WITHHELD)
  })

  test('starts with its instructions and ends with the report format', () => {
    const spec = buildAgentSpec('build', { model: 'opus', effort: 'medium' }, 'Do the build work.')

    expect(spec.prompt.startsWith('Do the build work.')).toBe(true)
    expect(lastSection(spec.prompt).startsWith('Report')).toBe(true)
    expect(lastSection(spec.prompt)).toContain('Open questions')
  })
})

describe('registering workflow:build', () => {
  test('a workflow in its build phase registers it at session start on the default plan', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')

    await start($)

    expect(fake.agents.at(-1)).toMatchObject({ name: 'build', model: 'opus', effort: 'medium' })
  })

  test('the model plan of the state file sets its model and effort', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ models: '[build haiku low]' }) }), 'feat/login')

    await start($)

    expect(fake.agents.at(-1)).toMatchObject({ name: 'build', model: 'haiku', effort: 'low' })
  })

  test('it cannot move the workflow or ask the user', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')

    await start($)

    expect(fake.agents.at(-1)?.disallowedTools).toEqual(expect.arrayContaining(WITHHELD))
  })

  test('its prompt holds the Agent section of the build phase and not the part for the conversation', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')

    await start($)

    const prompt = fake.agents.at(-1)?.prompt ?? ''
    expect(prompt).toContain('Do the build work.')
    expect(prompt).not.toContain('Talk the user through the slice.')
    expect(lastSection(prompt).startsWith('Report')).toBe(true)
  })

  test('its prompt names the slice to build and the checks to run', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')

    await start($)

    const prompt = fake.agents.at(-1)?.prompt ?? ''
    expect(prompt).toContain('Slice 1: Walking skeleton')
    expect(prompt).toContain('Form and route.')
    expect(prompt).toContain('`pnpm lint`, `pnpm tsc --noEmit`, `pnpm test`')
  })

  test('a workflow in another phase registers no agent', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ phase: 'design', slice: '0' }) }), 'feat/login')

    await start($)

    expect(fake.agents).toHaveLength(0)
  })

  test('a workflow on another branch registers no agent', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'main')

    await start($)

    expect(fake.agents).toHaveLength(0)
  })

  test('approving the slice phase registers it for the first slice', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ phase: 'slice', slice: '0' }) }), 'feat/login')
    fake.answers.push(GATE.approve)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Two slices.' })

    expect(fake.agents.at(-1)?.name).toBe('build')
    expect(fake.agents.at(-1)?.prompt).toContain('Slice 1: Walking skeleton')
  })

  test('switching to the workflow branch with /workflow continue registers it', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'main')
    fake.answers.push(SWITCH.yes('feat/login'))
    await start($)

    await run($, 'continue login')
    await fake.clock.settle()

    expect(fake.agents.at(-1)).toMatchObject({ name: 'build', model: 'opus', effort: 'medium' })
  })

  test('a verified slice registers it again for the next slice', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [TEST_FILE]: "it('totals', () => expect(total()).toBe(30))\n" }), 'feat/login')
    await start($)
    await bash($, fake, RED, 1)
    await $.tool.call({ tool: 'mcp__workflow__lock' })
    for (const command of CHECKS) await bash($, fake, command, 0)

    await $.tool.call({ tool: 'mcp__workflow__verify' })

    expect(fake.agents.at(-1)?.prompt).toContain('Slice 2: Password check')
  })
})

describe('the build phase prompt', () => {
  test('tells the conversation to spawn workflow:build for the current slice and relay its report', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')
    await start($)

    await run($, 'continue')
    await fake.clock.settle()

    expect(fake.prompts[0]).toEqual(expect.stringMatching(/Spawn `workflow:build`[^\n]*slice 1/))
    expect(fake.prompts[0]).toEqual(expect.stringMatching(/relay its report/i))
  })

  test('leaves the agent\'s instructions to the agent', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')
    await start($)

    await run($, 'continue')
    await fake.clock.settle()

    expect(fake.prompts[0]).toContain('Talk the user through the slice.')
    expect(fake.prompts[0]).not.toContain('Do the build work.')
  })
})
