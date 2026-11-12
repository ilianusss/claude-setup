import type { AgentSpec, On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { GATE } from '../src/labels'
import { DEFAULT_PLAN } from '../src/plan'
import { parseWorkflow, renderWorkflow, reviewRoundOf } from '../src/state'
import type { Workflow } from '../src/state'
import { STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'
import type { Fake } from './engine'

const STATE_FILE = `${STATE_DIR}/login.md`
const AGENT_TYPES: Record<string, string> = { r1: 'workflow:review', r2: 'workflow:review', b1: 'workflow:build' }
const BAND = {
  plugin: 'workflow',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  surface: 'terminal',
} as const

const WORKFLOW: Workflow = {
  slug: 'login',
  title: 'Add login',
  size: 'feature',
  phase: 'inspect',
  status: 'active',
  branch: 'feat/login',
  worktree: '/repo',
  slice: 2,
  reviewRound: 2,
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

function agentsAndTranscript(on: On): string[] {
  on('agent.list', () => ({
    value: Object.entries(AGENT_TYPES).map(([id, type]) => ({ id, type, description: type, status: 'completed' as const })),
  }))
  const lines: string[] = []
  on('ui.log', (_, e) => {
    if (e.to === 'transcript') lines.push(e.text)
    return { value: undefined }
  })
  return lines
}

function inspectRepo(fields: Partial<Record<string, string>> = {}): Record<string, string> {
  return buildRepo({ [STATE_FILE]: stateText({ phase: 'inspect', slice: '2', ...fields }) })
}

function state(fake: Fake): Workflow {
  return parseWorkflow(fake.files.get(STATE_FILE) ?? '')
}

async function runEnds($: Engine, agentId: string, reason: 'answer' | 'aborted' = 'answer'): Promise<void> {
  await $.turn.complete({ answer: 'Findings.', durationMs: 1, isAborted: reason === 'aborted', turnId: `t-${agentId}`, reason, agentId })
}

async function detailLine($: Engine): Promise<string> {
  const ui = await $.ui.mount(BAND)
  const found = (await ui.find({ type: 'Text', text: /working|waiting for you/ }))?.text ?? ''
  await ui.unmount()
  return found
}

async function promptOf($: Engine, fake: Fake): Promise<string> {
  await run($, 'continue')
  await fake.clock.settle()
  return fake.prompts[0] ?? ''
}

function agent(fake: Fake, name: string): AgentSpec | undefined {
  return fake.agents.filter(spec => spec.name === name).at(-1)
}

describe('the review round in the state file', () => {
  test('round-trips as review_round', () => {
    const text = renderWorkflow(WORKFLOW)

    expect(text).toContain('\nreview_round: 2\n')
    expect(parseWorkflow(text).reviewRound).toBe(2)
  })

  test('reads as round 0 from a state file written before it existed', () => {
    expect(reviewRoundOf(parseWorkflow(stateText({ phase: 'inspect' })))).toBe(0)
  })
})

describe('a review round', () => {
  test("ends when a workflow:review run ends in inspect: the state saves round 1 and logs it", async ($, on) => {
    agentsAndTranscript(on)
    const fake = fakeEngine(on, inspectRepo(), 'feat/login')
    await start($)

    await runEnds($, 'r1')

    expect(state(fake).reviewRound).toBe(1)
    expect(state(fake).log.at(-1)).toContain('review round 1')
  })

  test('a second review run saves round 2', async ($, on) => {
    agentsAndTranscript(on)
    const fake = fakeEngine(on, inspectRepo(), 'feat/login')
    await start($)

    await runEnds($, 'r1')
    await runEnds($, 'r2')

    expect(state(fake).reviewRound).toBe(2)
    expect(state(fake).log.at(-1)).toContain('review round 2')
  })

  test('says in the transcript that the round ended', async ($, on) => {
    const lines = agentsAndTranscript(on)
    fakeEngine(on, inspectRepo(), 'feat/login')
    await start($)

    await runEnds($, 'r1')

    expect(lines.some(line => line.includes('review round 1'))).toBe(true)
  })

  test('is not counted when a workflow:build run ends', async ($, on) => {
    agentsAndTranscript(on)
    const fake = fakeEngine(on, inspectRepo(), 'feat/login')
    await start($)

    await runEnds($, 'b1')

    expect(reviewRoundOf(state(fake))).toBe(0)
    expect(fake.files.get(STATE_FILE)).not.toMatch(/\nreview_round:/)
  })

  test('is not counted when the review run was interrupted', async ($, on) => {
    agentsAndTranscript(on)
    const fake = fakeEngine(on, inspectRepo(), 'feat/login')
    await start($)

    await runEnds($, 'r1', 'aborted')

    expect(reviewRoundOf(state(fake))).toBe(0)
  })

  test('is not counted outside the inspect phase', async ($, on) => {
    agentsAndTranscript(on)
    const fake = fakeEngine(on, buildRepo(), 'feat/login')
    await start($)

    await runEnds($, 'r1')

    expect(reviewRoundOf(state(fake))).toBe(0)
    expect(fake.files.get(STATE_FILE)).not.toMatch(/\nreview_round:/)
  })
})

describe('the band in inspect', () => {
  test('shows the saved review round out of 3 on its second line', async ($, on) => {
    fakeEngine(on, inspectRepo({ review_round: '2' }), 'feat/login')
    await start($)

    expect(await detailLine($)).toContain('inspect: review round 2/3')
  })

  test('shows the new round once a review run ends', async ($, on) => {
    agentsAndTranscript(on)
    fakeEngine(on, inspectRepo(), 'feat/login')
    await start($)

    await runEnds($, 'r1')

    expect(await detailLine($)).toContain('inspect: review round 1/3')
  })
})

describe('leaving inspect', () => {
  test('resets the review round', async ($, on) => {
    agentsAndTranscript(on)
    const fake = fakeEngine(on, inspectRepo({ size: 'project', review_round: '3' }), 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Pull request drafted.' })

    expect(state(fake).phase).toBe('retro')
    expect(reviewRoundOf(state(fake))).toBe(0)
    expect(fake.files.get(STATE_FILE)).not.toMatch(/\nreview_round:/)
  })
})

describe('the inspect prompt', () => {
  test('says how many of the 3 review rounds have ended', async ($, on) => {
    const fake = fakeEngine(on, inspectRepo({ review_round: '1' }), 'feat/login')
    await start($)

    const prompt = await promptOf($, fake)

    expect(prompt).toContain('## Review rounds')
    expect(prompt).toContain('1 of 3')
  })

  test('says that no round has ended at the start of inspect', async ($, on) => {
    const fake = fakeEngine(on, inspectRepo(), 'feat/login')
    await start($)

    const prompt = await promptOf($, fake)

    expect(prompt).toContain('0 of 3')
  })

  test('names workflow:build, on its plan model, for the fixes', async ($, on) => {
    const fake = fakeEngine(on, inspectRepo({ models: '[build sonnet high]' }), 'feat/login')
    await start($)

    const prompt = await promptOf($, fake)
    const rounds = prompt.slice(prompt.indexOf('## Review rounds'))

    expect(rounds).toContain('workflow:build')
    expect(rounds).toContain('sonnet high')
  })

  test('is not given the review rounds outside inspect', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'design', slice: '0' }) }), 'feat/login')
    await start($)

    expect(await promptOf($, fake)).not.toContain('## Review rounds')
  })
})

describe('workflow:build in inspect', () => {
  test('fixes review findings test-first without the slice lock, and runs every check', async ($, on) => {
    const fake = fakeEngine(on, inspectRepo(), 'feat/login')

    await start($)

    const prompt = agent(fake, 'build')?.prompt ?? ''
    const fixing = prompt.slice(prompt.indexOf('## Fixing review findings'))
    expect(prompt).toContain('## Fixing review findings')
    expect(fixing).toContain('failing test')
    expect(fixing).toContain('mcp__workflow__lock')
    for (const check of ['`pnpm lint`', '`pnpm tsc --noEmit`', '`pnpm test`']) expect(fixing).toContain(check)
    expect(prompt).not.toContain('## This slice')
  })

  test('in the build phase holds the slice and no fixing instructions', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')

    await start($)

    const prompt = agent(fake, 'build')?.prompt ?? ''
    expect(prompt).toContain('## This slice')
    expect(prompt).not.toContain('## Fixing review findings')
  })
})
