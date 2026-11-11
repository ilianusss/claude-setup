import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE } from '../src/labels'
import { subSteps } from '../src/phases'
import { DEFAULT_PLAN } from '../src/plan'
import { parseWorkflow, renderWorkflow } from '../src/state'
import type { Workflow } from '../src/state'
import { INTAKE_PHASE, STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'

const STATE_FILE = `${STATE_DIR}/login.md`
const INTAKE = buildRepo({ [STATE_FILE]: stateText({ phase: 'intake', slice: '0' }) })
const BAND = {
  plugin: 'workflow',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  surface: 'terminal',
} as const

function text(ran: { deny?: string; result?: unknown }): string {
  return ran.deny ?? String(ran.result)
}

async function detailLine($: Engine): Promise<string> {
  const ui = await $.ui.mount(BAND)
  const found = (await ui.find({ type: 'Text', text: /working|waiting for you/ }))?.text ?? ''
  await ui.unmount()
  return found
}

describe('the sub-step names', () => {
  test('come from the numbered bold titles of the With the user section', () => {
    expect(subSteps(INTAKE_PHASE)).toEqual(['ask', 'restate', 'save', 'gate'])
  })

  test('leave out the Agent section, nested lists and the trailing stop or colon', () => {
    const phase = [
      '# The design phase',
      '',
      '## With the user',
      '',
      '1. **Research.** Spawn the agent.',
      '   1. **Nested** is not a step.',
      '2. **Proposing options:** put them to the user.',
      '3. **Ask the user** what they decide.',
      '',
      'Rules:',
      '',
      '## Agent',
      '',
      '1. **Read** the spec.',
    ].join('\n')

    expect(subSteps(phase)).toEqual(['research', 'proposing options', 'ask the user'])
  })
})

describe('mcp__workflow__progress', () => {
  test('sets the sub-step of the current phase, saves it and shows it on the band', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__progress', step: 2 })

    expect(ran.deny).toBeUndefined()
    expect(text(ran)).toContain('restate')
    expect(parseWorkflow(fake.files.get(STATE_FILE) ?? '').step).toBe(2)
    expect(await detailLine($)).toContain('intake 2/4: restate')
  })

  for (const step of [0, 5, 2.5, -1]) {
    test(`refuses step ${step}, outside the phase's numbered steps, and changes nothing`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      await start($)
      const before = fake.files.get(STATE_FILE)

      const ran = await $.tool.call({ tool: 'mcp__workflow__progress', step })

      expect(ran.deny).toContain('1 to 4')
      expect(fake.files.get(STATE_FILE)).toBe(before)
    })
  }

  test('refuses a step that is not a number', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    await start($)
    const before = fake.files.get(STATE_FILE)

    const ran = await $.tool.call({ tool: 'mcp__workflow__progress', step: '2' as unknown as number })

    expect(ran.deny).toContain('1 to 4')
    expect(fake.files.get(STATE_FILE)).toBe(before)
  })

  for (const phase of ['build', 'inspect']) {
    test(`is refused in the ${phase} phase, whose sub-steps the mod names itself`, async ($, on) => {
      const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase }) }), 'feat/login')
      await start($)
      const before = fake.files.get(STATE_FILE)

      const ran = await $.tool.call({ tool: 'mcp__workflow__progress', step: 1 })

      expect(ran.deny).toContain(phase)
      expect(ran.deny).not.toContain('not implemented')
      expect(fake.files.get(STATE_FILE)).toBe(before)
    })
  }

  test('is refused from a step agent', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    await start($)
    const before = fake.files.get(STATE_FILE)

    const ran = await $.tool.call({ tool: 'mcp__workflow__progress', step: 2, agentId: 'a1' })

    expect(ran.deny).toContain('step agent')
    expect(fake.files.get(STATE_FILE)).toBe(before)
  })

  test('is refused without a workflow on this branch', async ($, on) => {
    fakeEngine(on, INTAKE, 'main')
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__progress', step: 2 })

    expect(ran.deny).toContain('no workflow')
  })
})

describe('the saved sub-step', () => {
  const WORKFLOW: Workflow = {
    slug: 'login',
    title: 'Add login',
    size: 'feature',
    phase: 'design',
    status: 'active',
    branch: 'feat/login',
    worktree: '/repo',
    slice: 0,
    step: 3,
    commits: false,
    autoNext: false,
    models: DEFAULT_PLAN,
    paths: [],
    session: 's1',
    updated: '2026-10-22T10:00:00.000Z',
    goal: 'Users sign in.',
    docs: [],
    stopped: '',
    next: '',
    questions: [],
    log: [],
  }

  test('round-trips through the state file', () => {
    expect(parseWorkflow(renderWorkflow(WORKFLOW)).step).toBe(3)
  })

  test('reads as none from a state file written before it existed', () => {
    expect(parseWorkflow(stateText({ phase: 'design', slice: '0' })).step).toBeUndefined()
  })

  test('shows on the band of a resumed workflow', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'intake', slice: '0', step: '3' }) }), 'feat/login')
    await start($)

    await run($, 'continue')
    await fake.clock.settle()

    expect(await detailLine($)).toContain('intake 3/4: save')
  })

  test('is cleared when the phase changes', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'intake', slice: '0', step: '4' }) }), 'feat/login')
    fake.answers.push(GATE.approve)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Users sign in.' })

    expect(parseWorkflow(fake.files.get(STATE_FILE) ?? '')).toMatchObject({ phase: 'design' })
    expect(parseWorkflow(fake.files.get(STATE_FILE) ?? '').step).toBeUndefined()
    expect(fake.files.get(STATE_FILE)).not.toMatch(/\nstep:/)
  })
})
