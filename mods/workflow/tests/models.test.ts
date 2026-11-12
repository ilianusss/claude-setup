import type { AgentSpec, On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { GATE, MODELS } from '../src/labels'
import { DEFAULT_PLAN } from '../src/plan'
import { parseWorkflow } from '../src/state'
import { STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'
import type { Fake } from './engine'

const STATE_FILE = `${STATE_DIR}/login.md`
const INTAKE = buildRepo({ [STATE_FILE]: stateText({ phase: 'intake', slice: '0' }) })
const DESIGN = buildRepo({ [STATE_FILE]: stateText({ phase: 'design', slice: '0', models: '[build sonnet low]' }) })
const SUMMARY = 'Users sign in with email and password.'
const RECOMMENDATIONS = [
  { step: 'build', model: 'sonnet', effort: 'high', reason: 'The slices are small and well specified.' },
  { step: 'review', model: 'opus', effort: 'xhigh', reason: 'Auth code: a subtle flaw would cost the most.' },
]
const PANE = 'workflow-models'

function state(fake: Fake) {
  return parseWorkflow(fake.files.get(STATE_FILE) ?? '')
}

function text(ran: { deny?: string; result?: unknown }): string {
  return ran.deny ?? String(ran.result)
}

function agent(fake: Fake, name: string): AgentSpec | undefined {
  return fake.agents.filter(spec => spec.name === name).at(-1)
}

function recordOptions(on: On): string[][] {
  const offered: string[][] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e, next) => {
    if (e.tool === 'AskUserQuestion') offered.push(e.questions[0]?.options.map(option => option.label) ?? [])
    return next(e)
  })
  return offered
}

function hasModelsLog(fake: Fake): boolean {
  return state(fake).log.some(entry => entry.includes('models changed'))
}

describe('the model question at the intake gate', () => {
  test('follows Continue with the defaults, the recommendations or a choice per step', async ($, on) => {
    const offered = recordOptions(on)
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.approve, MODELS.defaults)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY, recommendations: RECOMMENDATIONS })

    expect(fake.questions[1]).toBe('Which models should the steps use?')
    expect(offered[1]).toEqual(['Use the defaults', "Use Claude's recommendations", 'Choose per step'])
  })

  test('leaves out the recommendations when Claude gave none', async ($, on) => {
    const offered = recordOptions(on)
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.approve, MODELS.defaults)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY })

    expect(offered[1]).toEqual(['Use the defaults', 'Choose per step'])
  })

  test('is asked after Stop here too, and the answer is saved before the workflow pauses', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.stop, MODELS.recommended)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY, recommendations: RECOMMENDATIONS })

    expect(fake.questions[1]).toBe(MODELS.question)
    expect(state(fake)).toMatchObject({
      phase: 'design',
      status: 'paused',
      models: { ...DEFAULT_PLAN, build: { model: 'sonnet', effort: 'high' }, review: { model: 'opus', effort: 'xhigh' } },
    })
    expect(text(ran)).toContain('/workflow continue login')
  })

  test('after Stop here, choosing per step in the panel says the user stops once they have chosen', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.stop, MODELS.perStep)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY, recommendations: RECOMMENDATIONS })

    expect(fake.opened[0]).toMatchObject({ id: PANE })
    expect(text(ran)).toContain('Models panel')
    expect(text(ran)).toContain('/workflow continue login')
    expect(state(fake)).toMatchObject({ phase: 'design', status: 'paused' })
  })

  test('is not asked at the gate of another phase', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.approve)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B.' })

    expect(fake.questions).toHaveLength(1)
  })

  test('Use the defaults saves the default plan and goes on with the next phase', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'intake', slice: '0', models: '[build haiku low]' }) }), 'feat/login')
    fake.answers.push(GATE.approve, MODELS.defaults)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY, recommendations: RECOMMENDATIONS })

    expect(state(fake)).toMatchObject({ phase: 'design', models: DEFAULT_PLAN })
    expect(hasModelsLog(fake)).toBe(true)
    expect(agent(fake, 'build')).toMatchObject({ model: 'opus', effort: 'medium' })
    expect(text(ran)).toContain('Do the design work.')
  })

  test("Use Claude's recommendations saves them over the defaults, logs it and registers the agents on them", async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.approve, MODELS.recommended)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY, recommendations: RECOMMENDATIONS })

    expect(state(fake).models).toEqual({ ...DEFAULT_PLAN, build: { model: 'sonnet', effort: 'high' }, review: { model: 'opus', effort: 'xhigh' } })
    expect(hasModelsLog(fake)).toBe(true)
    expect(agent(fake, 'build')).toMatchObject({ model: 'sonnet', effort: 'high' })
    expect(agent(fake, 'review')).toMatchObject({ model: 'opus', effort: 'xhigh' })
    expect(text(ran)).toContain('Do the design work.')
  })

  test('a dismissed model question keeps the plan and goes on with the next phase', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.approve)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY, recommendations: RECOMMENDATIONS })

    expect(state(fake)).toMatchObject({ phase: 'design', models: DEFAULT_PLAN })
    expect(hasModelsLog(fake)).toBe(false)
    expect(text(ran)).toContain('Do the design work.')
  })

  test('Not yet keeps the phase and the plan', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.wait)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY, recommendations: RECOMMENDATIONS })

    expect(state(fake)).toMatchObject({ phase: 'intake', models: DEFAULT_PLAN })
    expect(fake.questions).toHaveLength(1)
  })
})

describe('recommendations the gate refuses', () => {
  test('outside the intake gate are refused before any dialog, and nothing moves', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.approve)
    await start($)
    const before = fake.files.get(STATE_FILE)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B.', recommendations: RECOMMENDATIONS })

    expect(ran.deny).toContain('intake')
    expect(fake.questions).toHaveLength(0)
    expect(fake.files.get(STATE_FILE)).toBe(before)
  })

  const refused: Array<[string, unknown, string]> = [
    ['Fable', [{ step: 'build', model: 'fable', effort: 'medium', reason: 'The best.' }], 'build fable medium'],
    ['max effort', [{ step: 'design', model: 'opus', effort: 'max', reason: 'Hard.' }], 'design opus max'],
    ['xhigh without a reason', [{ step: 'review', model: 'opus', effort: 'xhigh' }], 'review opus xhigh'],
    ['an unknown step', [{ step: 'deploy', model: 'opus', effort: 'high' }], 'deploy opus high'],
    ['an unknown model', [{ step: 'build', model: 'gpt-5', effort: 'high' }], 'build gpt-5 high'],
    ['a step this workflow does not run', [{ step: 'spec', model: 'opus', effort: 'medium' }], 'spec opus medium'],
  ]
  for (const [name, recommendations, entry] of refused) {
    test(`naming ${name} are refused with the entry named, before any dialog, and nothing moves`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      fake.answers.push(GATE.approve, MODELS.recommended)
      await start($)
      const before = fake.files.get(STATE_FILE)

      const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY, recommendations })

      expect(ran.deny).toContain(entry)
      expect(fake.questions).toHaveLength(0)
      expect(fake.files.get(STATE_FILE)).toBe(before)
    })
  }

  test('that are not a list of entries are refused, and nothing moves', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.approve, MODELS.recommended)
    await start($)
    const before = fake.files.get(STATE_FILE)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY, recommendations: 'build opus xhigh' })

    expect(ran.deny).toContain('recommendations')
    expect(fake.files.get(STATE_FILE)).toBe(before)
  })
})

describe('the choice per step when the panel cannot be shown', () => {
  const ALL_RECOMMENDED = ['sonnet medium (Recommended)', 'opus high (Recommended)', 'opus high (Recommended)', 'sonnet high (Recommended)', 'opus xhigh (Recommended)']

  test('asks one dialog per step of this workflow, in pipeline order, and closes the undrawn panel', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.isPlaced = false
    fake.answers.push(GATE.approve, MODELS.perStep, ...ALL_RECOMMENDED)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY, recommendations: RECOMMENDATIONS })

    const steps = fake.questions.slice(2)
    expect(steps).toHaveLength(5)
    expect(['map', 'design', 'slice', 'build', 'review'].map((step, index) => steps[index]?.includes(`the ${step} step`))).toEqual([true, true, true, true, true])
    expect(fake.closed).toContain(PANE)
  })

  test('offers the recommended value first, then the default when different, one cheaper and one stronger', async ($, on) => {
    const offered = recordOptions(on)
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.isPlaced = false
    fake.answers.push(GATE.approve, MODELS.perStep, ...ALL_RECOMMENDED)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY, recommendations: RECOMMENDATIONS })

    expect(offered[3]).toEqual(['opus high (Recommended)', 'opus medium', 'opus xhigh'])
    expect(offered[5]).toEqual(['sonnet high (Recommended)', 'opus medium (default)', 'sonnet medium'])
    expect(fake.questions[5]).toContain('The slices are small and well specified.')
  })

  test('never offers Fable or max', async ($, on) => {
    const offered = recordOptions(on)
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.isPlaced = false
    fake.answers.push(GATE.approve, MODELS.perStep, ...ALL_RECOMMENDED)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY, recommendations: RECOMMENDATIONS })

    expect(offered.flat().filter(label => /fable|max/i.test(label))).toEqual([])
  })

  test('saves the answers, logs the change, registers the agents and goes on with the next phase', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.isPlaced = false
    fake.answers.push(GATE.approve, MODELS.perStep, ...ALL_RECOMMENDED)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY, recommendations: RECOMMENDATIONS })

    expect(state(fake).models).toEqual({ ...DEFAULT_PLAN, build: { model: 'sonnet', effort: 'high' }, review: { model: 'opus', effort: 'xhigh' } })
    expect(hasModelsLog(fake)).toBe(true)
    expect(agent(fake, 'review')).toMatchObject({ model: 'opus', effort: 'xhigh' })
    expect(text(ran)).toContain('Do the design work.')
  })

  test('takes a model and effort typed under Other', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.isPlaced = false
    fake.answers.push(GATE.approve, MODELS.perStep, 'Haiku  Low', 'opus high (Recommended)', 'opus high (Recommended)', 'sonnet low', 'opus high')
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY })

    expect(state(fake).models).toMatchObject({ map: { model: 'haiku', effort: 'low' }, build: { model: 'sonnet', effort: 'low' } })
  })

  test('asks again when the text typed under Other names Fable, max or nothing it knows', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.isPlaced = false
    fake.answers.push(GATE.approve, MODELS.perStep, 'fable high', 'opus max', 'gpt-5 high', 'haiku low', 'opus high', 'opus high', 'opus medium', 'opus high')
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY })

    expect(fake.questions.slice(2, 6).every(question => question.includes('the map step'))).toBe(true)
    expect(fake.questions[3]).toContain('fable high')
    expect(state(fake).models.map).toEqual({ model: 'haiku', effort: 'low' })
  })

  test('a dismissed dialog keeps the whole plan and goes on with the next phase', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.isPlaced = false
    fake.answers.push(GATE.approve, MODELS.perStep, 'haiku low', 'sonnet high')
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY, recommendations: RECOMMENDATIONS })

    expect(state(fake)).toMatchObject({ phase: 'design', models: DEFAULT_PLAN })
    expect(hasModelsLog(fake)).toBe(false)
    expect(text(ran)).toContain('Do the design work.')
  })
})

describe('the choice per step in the panel', () => {
  test('opens the panel as a focused dialog and waits for the user before the next phase', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.approve, MODELS.perStep)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: SUMMARY, recommendations: RECOMMENDATIONS })
    await fake.clock.settle()

    expect(fake.opened[0]).toMatchObject({ id: PANE, focus: true, closeOnEscape: true, holdToasts: true })
    expect(state(fake)).toMatchObject({ phase: 'design', models: DEFAULT_PLAN })
    expect(text(ran)).toContain('Models panel')
    expect(text(ran)).not.toContain('Do the design work.')
    expect(fake.prompts).toHaveLength(0)
  })
})

describe('/workflow models', () => {
  test('opens the panel for the workflow on this branch', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    await start($)

    const ran = await run($, 'models')

    expect(fake.opened[0]).toMatchObject({ id: PANE, focus: true, closeOnEscape: true, holdToasts: true })
    expect(ran.text).toContain('Models panel')
  })

  test('without a workflow on this branch says so and opens nothing', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'main')
    await start($)

    const ran = await run($, 'models')

    expect(ran.text).toContain('no workflow')
    expect(fake.opened).toHaveLength(0)
  })

  test('asks one dialog per step when the panel cannot be shown, then saves, logs and registers the agents', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.isPlaced = false
    fake.answers.push('sonnet medium (Recommended)', 'opus high (Recommended)', 'opus high (Recommended)', 'sonnet high', 'opus high (Recommended)')
    await start($)

    const ran = await run($, 'models')
    await fake.clock.settle()

    expect(fake.questions).toHaveLength(5)
    expect(fake.questions[3]).toContain('sonnet low')
    expect(state(fake).models.build).toEqual({ model: 'sonnet', effort: 'high' })
    expect(hasModelsLog(fake)).toBe(true)
    expect(agent(fake, 'build')).toMatchObject({ model: 'sonnet', effort: 'high' })
    expect(ran.text).toContain('build sonnet high')
    expect(fake.prompts).toHaveLength(0)
  })
})
