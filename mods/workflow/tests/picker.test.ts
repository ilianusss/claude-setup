import type { AgentSpec } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { WorkflowPicker } from '../types'
import { GATE, MODELS } from '../src/labels'
import { withPick } from '../src/picker'
import { DEFAULT_PLAN } from '../src/plan'
import { parseWorkflow } from '../src/state'
import { CONTINUE, INTAKE_POINTS, STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'
import type { Fake } from './engine'

const STATE_FILE = `${STATE_DIR}/login.md`
const INTAKE = buildRepo({ [STATE_FILE]: stateText({ phase: 'intake', slice: '0' }) })
const DESIGN = buildRepo({ [STATE_FILE]: stateText({ phase: 'design', slice: '0', models: '[build sonnet low]' }) })
const RECOMMENDATIONS = [
  { step: 'build', model: 'sonnet', effort: 'high', reason: 'The slices are small and well specified.' },
  { step: 'review', model: 'opus', effort: 'xhigh', reason: 'Auth code: a subtle flaw would cost the most.' },
]
const PANE = {
  plugin: 'workflow',
  component: 'Pane',
  requestId: 'workflow-models',
  props: { title: 'Models', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const SURFACES = ['terminal', 'desktop'] as const
const ALLOWED_MODELS = ['haiku', 'sonnet', 'opus']
const ALLOWED_EFFORTS = ['low', 'medium', 'high', 'xhigh']
const THEME_COLOURS = ['suggestion', 'warning']

function state(fake: Fake) {
  return parseWorkflow(fake.files.get(STATE_FILE) ?? '')
}

function agent(fake: Fake, name: string): AgentSpec | undefined {
  return fake.agents.filter(spec => spec.name === name).at(-1)
}

type Option = { value: string; label?: string }

function optionsOf(found: { props: Record<string, unknown> } | undefined): Option[] {
  return (found?.props.options ?? []) as Option[]
}

async function choosingAtIntake($: Engine, fake: Fake): Promise<void> {
  fake.answers.push(GATE.continue, MODELS.perStep)
  await start($)
  await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS, recommendations: RECOMMENDATIONS })
}

describe('the model picker panel', () => {
  for (const surface of SURFACES) {
    test(`on ${surface}, has a title and one line saying what it sets`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      await choosingAtIntake($, fake)

      const ui = await $.ui.mount({ ...PANE, surface })

      expect((await ui.find({ type: 'Text', text: /Models for login/ }))?.props.weight).toBe('bold')
      expect(await ui.find({ type: 'Text', text: /own agent/ })).toBeDefined()
      await ui.unmount()
    })

    test(`on ${surface}, has one model and one effort picker per step of this workflow, in pipeline order`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      await choosingAtIntake($, fake)

      const ui = await $.ui.mount({ ...PANE, surface })
      const keys = (await ui.findAll({ type: 'Select' })).map(select => select.key)

      expect(keys).toEqual([
        'model-map', 'effort-map', 'model-design', 'effort-design', 'model-slice', 'effort-slice',
        'model-build', 'effort-build', 'model-review', 'effort-review',
      ])
      await ui.unmount()
    })

    test(`on ${surface}, never offers Fable or max`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      await choosingAtIntake($, fake)

      const ui = await $.ui.mount({ ...PANE, surface })
      const selects = await ui.findAll({ type: 'Select' })

      for (const select of selects) {
        const allowed = select.key?.startsWith('model-') ? ALLOWED_MODELS : ALLOWED_EFFORTS
        expect(optionsOf(select).map(option => option.value)).toEqual(allowed)
      }
      expect(selects.flatMap(select => optionsOf(select).map(option => option.label ?? '')).filter(label => /fable|max/i.test(label))).toEqual([])
      await ui.unmount()
    })

    test(`on ${surface}, marks the recommended values in each picker and shows the reason in a dim line`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      await choosingAtIntake($, fake)

      const ui = await $.ui.mount({ ...PANE, surface })
      const buildModel = optionsOf(await ui.find({ key: 'model-build' }))
      const buildEffort = optionsOf(await ui.find({ key: 'effort-build' }))
      const designModel = optionsOf(await ui.find({ key: 'model-design' }))

      expect(buildModel.find(option => option.value === 'sonnet')?.label).toContain('recommended')
      expect(buildModel.find(option => option.value === 'opus')?.label ?? 'opus').not.toContain('recommended')
      expect(buildEffort.find(option => option.value === 'high')?.label).toContain('recommended')
      expect(designModel.find(option => option.value === 'opus')?.label).toContain('recommended')
      expect((await ui.find({ type: 'Text', text: /small and well specified/ }))?.props.dimColor).toBe(true)
      await ui.unmount()
    })

    test(`on ${surface}, at the intake preselects Claude's recommendations, the defaults elsewhere, and starts the focus on the first picker`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      await choosingAtIntake($, fake)

      const ui = await $.ui.mount({ ...PANE, surface })

      expect((await ui.find({ key: 'model-build' }))?.props.value).toBe('sonnet')
      expect((await ui.find({ key: 'effort-build' }))?.props.value).toBe('high')
      expect((await ui.find({ key: 'effort-review' }))?.props.value).toBe('xhigh')
      expect((await ui.find({ key: 'model-design' }))?.props.value).toBe('opus')
      expect((await ui.find({ key: 'effort-design' }))?.props.value).toBe('high')
      expect((await ui.find({ key: 'model-map' }))?.props.autoFocus).toBe(true)
      await ui.unmount()
    })

    test(`on ${surface}, shows clearly a step whose choice differs from the default`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      await choosingAtIntake($, fake)
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.findAll({ type: 'Text', text: /changed/ })).toHaveLength(2)
      await ui.select({ key: 'model-build', value: 'opus' })
      await ui.select({ key: 'effort-build', value: 'medium' })
      await ui.select({ key: 'effort-review', value: 'high' })
      expect(await ui.find({ type: 'Text', text: /changed/ })).toBeUndefined()

      await ui.select({ key: 'model-build', value: 'sonnet' })

      const changed = await ui.findAll({ type: 'Text', text: /changed/ })
      expect(changed).toHaveLength(1)
      expect(changed[0]?.text).toContain('opus medium')
      expect(changed[0]?.props.dimColor).not.toBe(true)
      await ui.unmount()
    })

    test(`on ${surface}, heads its columns Step, Model, Effort and Default, dimmed`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      await choosingAtIntake($, fake)

      const ui = await $.ui.mount({ ...PANE, surface })

      for (const heading of ['Step', 'Model', 'Effort', 'Default']) {
        expect((await ui.find({ type: 'Text', text: new RegExp(`^${heading}$`) }))?.props.dimColor).toBe(true)
      }
      await ui.unmount()
    })

    test(`on ${surface}, shows the default of each step left at its default, dimmed`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      await choosingAtIntake($, fake)

      const ui = await $.ui.mount({ ...PANE, surface })
      const defaults = await ui.findAll({ type: 'Text', text: /^opus high$/ })

      expect(defaults).toHaveLength(2)
      expect(defaults.map(found => found.props.dimColor)).toEqual([true, true])
      expect((await ui.find({ type: 'Text', text: /^sonnet medium$/ }))?.props.dimColor).toBe(true)
      await ui.unmount()
    })

    test(`on ${surface}, draws the name of a step that differs from its default in the suggestion colour`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      await choosingAtIntake($, fake)

      const ui = await $.ui.mount({ ...PANE, surface })

      expect((await ui.find({ type: 'Text', text: /^build$/ }))?.props.color).toBe('suggestion')
      expect((await ui.find({ type: 'Text', text: /^design$/ }))?.props.color).toBeUndefined()
      await ui.unmount()
    })

    test(`on ${surface}, shows a recommendation line only under the steps Claude recommended`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      await choosingAtIntake($, fake)

      const ui = await $.ui.mount({ ...PANE, surface })

      expect(await ui.findAll({ type: 'Text', text: /Claude/ })).toHaveLength(2)
      await ui.unmount()
    })

    test(`on ${surface}, colours its text with theme colour names only`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      await choosingAtIntake($, fake)

      const ui = await $.ui.mount({ ...PANE, surface })
      const colours = (await ui.findAll({ type: 'Text' })).map(found => found.props.color).filter(colour => colour !== undefined)

      expect(colours.length).toBeGreaterThan(0)
      expect(colours.filter(colour => !THEME_COLOURS.includes(String(colour)))).toEqual([])
      await ui.unmount()
    })

    test(`on ${surface}, on a narrow pane, leaves out the column headings, keeps each step and its pickers, and names the default in its cell`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      await choosingAtIntake($, fake)

      const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns: 60 } })

      expect(await ui.find({ type: 'Text', text: /^Default$/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^build$/ })).toBeDefined()
      expect(await ui.findAll({ type: 'Text', text: /^default opus high$/ })).toHaveLength(2)
      expect(await ui.findAll({ type: 'Select' })).toHaveLength(10)
      await ui.unmount()
    })

    test(`on ${surface}, warns in one line when xhigh is picked`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      await choosingAtIntake($, fake)
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.findAll({ type: 'Text', text: /hard problems/ })).toHaveLength(1)
      await ui.select({ key: 'effort-review', value: 'high' })
      expect(await ui.find({ type: 'Text', text: /hard problems/ })).toBeUndefined()

      await ui.select({ key: 'effort-design', value: 'xhigh' })

      expect(await ui.findAll({ type: 'Text', text: /hard problems/ })).toHaveLength(1)
      await ui.unmount()
    })

    test(`on ${surface}, offers Use these, Reset to recommended and Cancel, Use these as the main action`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      await choosingAtIntake($, fake)

      const ui = await $.ui.mount({ ...PANE, surface })
      const buttons = await ui.findAll({ type: 'Button' })

      expect(buttons.map(button => button.props.label)).toEqual(['Use these', 'Reset to recommended', 'Cancel'])
      expect(buttons[0]?.props.variant).toBe('primary')
      await ui.unmount()
    })
  }

  test('Reset to recommended puts every recommended value back in the pickers', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    await choosingAtIntake($, fake)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.select({ key: 'model-design', value: 'haiku' })

    await ui.press({ key: 'reset' })

    expect((await ui.find({ key: 'model-design' }))?.props.value).toBe('opus')
    expect((await ui.find({ key: 'model-build' }))?.props.value).toBe('sonnet')
    expect((await ui.find({ key: 'effort-build' }))?.props.value).toBe('high')
    expect((await ui.find({ key: 'effort-review' }))?.props.value).toBe('xhigh')
    await ui.unmount()
  })

  test('Use these saves the plan, logs it, registers the agents, closes the panel and fills /workflow continue without starting the phase', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    await choosingAtIntake($, fake)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.select({ key: 'effort-build', value: 'medium' })
    await ui.select({ key: 'effort-review', value: 'high' })
    await ui.select({ key: 'model-build', value: 'sonnet' })

    await ui.press({ key: 'use' })
    await fake.clock.settle()

    expect(state(fake).models).toEqual({ ...DEFAULT_PLAN, build: { model: 'sonnet', effort: 'medium' } })
    expect(state(fake).log.some(entry => entry.includes('models changed'))).toBe(true)
    expect(agent(fake, 'build')).toMatchObject({ model: 'sonnet', effort: 'medium' })
    expect(fake.closed).toContain('workflow-models')
    expect(fake.fills).toEqual([CONTINUE])
    expect(fake.prompts).toHaveLength(0)
    await ui.unmount()
  })

  test('after Stop here at the intake, Use these saves the plan and sends no phase prompt', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.stop, MODELS.perStep)
    await start($)
    await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS, recommendations: RECOMMENDATIONS })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.select({ key: 'model-build', value: 'sonnet' })

    await ui.press({ key: 'use' })
    await fake.clock.settle()

    expect(state(fake)).toMatchObject({ phase: 'design', status: 'paused' })
    expect(state(fake).models.build.model).toBe('sonnet')
    expect(fake.fills).toEqual([])
    expect(fake.prompts).toHaveLength(0)
    await ui.unmount()
  })

  test('Cancel keeps the plan, closes the panel and fills /workflow continue without starting the phase', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    await choosingAtIntake($, fake)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.select({ key: 'model-build', value: 'haiku' })

    await ui.press({ key: 'cancel' })
    await fake.clock.settle()

    expect(state(fake).models).toEqual(DEFAULT_PLAN)
    expect(state(fake).log.some(entry => entry.includes('models changed'))).toBe(false)
    expect(fake.closed).toContain('workflow-models')
    expect(fake.fills).toEqual([CONTINUE])
    expect(fake.prompts).toHaveLength(0)
    await ui.unmount()
  })

  test('from /workflow models preselects the current plan, and Use these saves it without a new prompt', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    await start($)
    await run($, 'models')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ key: 'model-build' }))?.props.value).toBe('sonnet')
    expect((await ui.find({ key: 'effort-build' }))?.props.value).toBe('low')

    await ui.select({ key: 'effort-build', value: 'high' })
    await ui.press({ key: 'use' })
    await fake.clock.settle()

    expect(state(fake).models.build).toEqual({ model: 'sonnet', effort: 'high' })
    expect(state(fake).log.some(entry => entry.includes('models changed'))).toBe(true)
    expect(agent(fake, 'build')).toMatchObject({ model: 'sonnet', effort: 'high' })
    expect(fake.prompts).toHaveLength(0)
    await ui.unmount()
  })

  test('from /workflow models shows the recommendations Claude gave at the intake in this session', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.stop)
    await start($)
    await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS, recommendations: RECOMMENDATIONS })

    await run($, 'models')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    expect(optionsOf(await ui.find({ key: 'model-build' })).find(option => option.value === 'sonnet')?.label).toContain('recommended')
    await ui.unmount()
  })
})

describe('a pick the panel did not offer', () => {
  const PICKER: WorkflowPicker = {
    slug: 'login',
    steps: ['map', 'design', 'slice', 'build', 'review'],
    plan: ['build opus medium'],
    recommendations: [],
    then: 'stay',
  }

  test('naming Fable or an unknown model changes nothing', () => {
    expect(withPick(PICKER, 'build', 'model', 'fable')).toEqual(PICKER)
    expect(withPick(PICKER, 'build', 'model', 'gpt-5')).toEqual(PICKER)
  })

  test('naming max or an unknown effort changes nothing', () => {
    expect(withPick(PICKER, 'build', 'effort', 'max')).toEqual(PICKER)
    expect(withPick(PICKER, 'build', 'effort', 'high; rm -rf /')).toEqual(PICKER)
  })

  test('for a step the panel does not show changes nothing', () => {
    expect(withPick(PICKER, 'spec', 'model', 'haiku')).toEqual(PICKER)
  })

  test('of an offered value changes that step alone', () => {
    expect(withPick(PICKER, 'build', 'effort', 'high').plan).toContain('build opus high')
  })
})
