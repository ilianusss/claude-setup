import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { WorkflowBanner } from '../types'
import { detailLine, stepSegments } from '../src/banner'
import { GATE, MODELS, NEXT_SLICE } from '../src/labels'
import { statusText } from '../src/status'
import { ROOT, STATE_DIR, buildRepo, fakeEngine, start, stateText } from './engine'
import type { Fake } from './engine'

const STATE_FILE = `${STATE_DIR}/login.md`
const TEST_FILE = `${ROOT}/src/cart.test.ts`
const RED = 'pnpm vitest run src/cart.test.ts'
const CHECKS = [RED, 'pnpm lint', 'pnpm tsc --noEmit', 'pnpm test']
const SURFACES = ['terminal', 'desktop'] as const
const DONE_MARKERS = /[✓✔✅]|\[x\]|\bdone\b/i
const BAND = {
  plugin: 'workflow',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

function repo(fields: Partial<Record<string, string>> = {}): Record<string, string> {
  return buildRepo({ [STATE_FILE]: stateText(fields) })
}

function withoutConfig(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => path !== `${ROOT}/.claude/workflow.json`))
}

function mountBand($: Engine, surface: 'terminal' | 'desktop' = 'terminal', props: { hasSurvey?: boolean } = {}) {
  return $.ui.mount({ ...BAND, props: { ...BAND.props, ...props }, surface })
}

async function bandLines($: Engine, surface: 'terminal' | 'desktop' = 'terminal'): Promise<{ steps: string; detail: string }> {
  const ui = await mountBand($, surface)
  const steps = (await ui.find({ type: 'Text', text: /intake/ }))?.text ?? ''
  const detail = (await ui.find({ type: 'Text', text: /working|waiting for you/ }))?.text ?? ''
  await ui.unmount()
  return { steps, detail }
}

async function submitPrompt($: Engine): Promise<void> {
  await $.prompt.submit({ text: 'Go on.', wait: false, origin: { kind: 'composer' } })
}

async function turnEnds($: Engine, agentId?: string): Promise<void> {
  await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: `t-${agentId ?? 'main'}`, reason: 'answer', agentId })
}

async function lockedSlice($: Engine, fake: Fake, agentId?: string): Promise<void> {
  fake.bash.set(RED, 1)
  await $.tool.call({ tool: 'Bash', command: RED })
  await $.tool.call({ tool: 'mcp__workflow__lock', agentId })
}

async function greenChecks($: Engine, fake: Fake): Promise<void> {
  for (const command of CHECKS) {
    fake.bash.set(command, 0)
    await $.tool.call({ tool: 'Bash', command })
  }
}

function view(fields: Partial<WorkflowBanner> = {}): WorkflowBanner {
  return {
    slug: 'login',
    phases: ['intake', 'design', 'slice', 'build', 'inspect'],
    phase: 'design',
    slice: null,
    step: { name: 'proposing options', number: 3, count: 6 },
    runner: 'opus high',
    ...fields,
  }
}

describe('the first line of the band', () => {
  for (const surface of SURFACES) {
    test(`on ${surface}, lists the steps of a feature in pipeline order, the current one bold and coloured, the others dim`, async ($, on) => {
      fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
      await start($)

      const ui = await mountBand($, surface)
      const line = (await ui.find({ type: 'Text', text: /intake/ }))?.text ?? ''
      const current = await ui.find({ type: 'Text', text: /^design$/ })
      const others = await Promise.all(['intake', 'slice', 'build', 'inspect'].map(step => ui.find({ type: 'Text', text: new RegExp(`^${step}$`) })))

      expect(line).toMatch(/intake.*design.*slice.*build.*inspect/)
      expect(current?.props.weight).toBe('bold')
      expect(current?.props.color).toBeDefined()
      expect(current?.props.dimColor).not.toBe(true)
      expect(others.map(other => other?.props.dimColor)).toEqual([true, true, true, true])
      await ui.unmount()
    })

    test(`on ${surface}, shows no done marker on the steps already behind`, async ($, on) => {
      fakeEngine(on, repo({ phase: 'inspect' }), 'feat/login')
      await start($)

      const { steps } = await bandLines($, surface)

      expect(steps).toMatch(/intake.*inspect/)
      expect(steps).not.toMatch(DONE_MARKERS)
    })
  }

  test('lists setup, spec and retro for a project that has no workflow.json yet', async ($, on) => {
    fakeEngine(on, withoutConfig(repo({ size: 'project', phase: 'intake', slice: '0' })), 'feat/login')
    await start($)

    const { steps } = await bandLines($)

    expect(steps).toMatch(/intake.*setup.*spec.*design.*slice.*build.*inspect.*retro/)
  })

  test('leaves setup out once the project has its workflow.json', async ($, on) => {
    fakeEngine(on, repo({ size: 'project', phase: 'spec', slice: '0' }), 'feat/login')
    await start($)

    const { steps } = await bandLines($)

    expect(steps).toMatch(/intake.*spec.*design.*slice.*build.*inspect.*retro/)
    expect(steps).not.toContain('setup')
  })

  test('shows the slice count on build', async ($, on) => {
    fakeEngine(on, repo(), 'feat/login')
    await start($)

    const ui = await mountBand($)

    expect((await ui.find({ type: 'Text', text: /^build 1\/2$/ }))?.props.weight).toBe('bold')
    await ui.unmount()
  })

  test('draws nothing without a workflow on this branch', async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'main')
    await start($)

    const ui = await mountBand($)

    expect(await ui.find({ type: 'Text' })).toBeUndefined()
    await ui.unmount()
  })

  test('gives the band to a survey', async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    await start($)

    const ui = await mountBand($, 'terminal', { hasSurvey: true })

    expect(await ui.find({ type: 'Text' })).toBeUndefined()
    await ui.unmount()
  })

  test('in a narrow terminal keeps the current step in view and fits the width', () => {
    const segments = stepSegments(view({ phase: 'build', slice: { number: 2, count: 5 }, step: { name: 'tests locked' } }), 24)
    const width = segments.map(segment => segment.label).join('  ').length

    expect(segments.find(segment => segment.isCurrent)?.label).toBe('build 2/5')
    expect(width).toBeLessThanOrEqual(24)
  })

  test('in a wide terminal lists every step, only the current one marked', () => {
    const segments = stepSegments(view(), 100)

    expect(segments).toEqual([
      { label: 'intake', isCurrent: false },
      { label: 'design', isCurrent: true },
      { label: 'slice', isCurrent: false },
      { label: 'build', isCurrent: false },
      { label: 'inspect', isCurrent: false },
    ])
  })
})

describe('the second line of the band', () => {
  test("names the model and effort of the step's agent, from the plan", async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0', models: '[design sonnet low]' }), 'feat/login')
    await start($)

    const { detail } = await bandLines($)

    expect(detail).toContain('design')
    expect(detail).toContain('sonnet low')
  })

  test('says the intake runs in the conversation', async ($, on) => {
    fakeEngine(on, repo({ phase: 'intake', slice: '0' }), 'feat/login')
    await start($)

    const { detail } = await bandLines($)

    expect(detail).toContain('conversation')
  })

  test('says working from a submitted prompt, then waiting for you once the turn completes', async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    await start($)

    await submitPrompt($)
    const working = (await bandLines($)).detail
    await turnEnds($)
    const waiting = (await bandLines($)).detail

    expect(working).toContain('working')
    expect(waiting).toContain('waiting for you')
  })

  test('a failing activity update still submits the prompt and is logged to debug', async ($, on) => {
    const logged: Array<{ text: string; to: string }> = []
    on('ui.log', (_, e) => {
      logged.push({ text: e.text, to: e.to })
      return { value: undefined }
    })
    on('state.set', { plugin: 'workflow', key: 'activity' }, () => ({ deny: 'the state host is gone' }))
    const fake = fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    await start($)

    await submitPrompt($)

    expect(fake.prompts).toEqual(['Go on.'])
    expect(logged.filter(line => line.to === 'debug').map(line => line.text).join('\n')).toContain('the state host is gone')
  })

  test("stays working when a step agent's turn completes", async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    await start($)
    await submitPrompt($)

    await turnEnds($, 'a1')

    expect((await bandLines($)).detail).toContain('working')
  })

  test("says waiting for you while one of the mod's dialogs is open, then working again", async ($, on) => {
    const seen: string[] = []
    on('tool.call', { tool: 'AskUserQuestion' }, (_, e, next) => {
      seen.push(fake.statuses.at(-1) ?? '')
      return next(e)
    })
    const fake = fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    fake.answers.push(GATE.wait)
    await start($)
    await submitPrompt($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B.' })

    expect(seen[0]).toContain('waiting for you')
    expect(fake.statuses.at(-1)).toContain('working')
  })

  test('says waiting for you while the Models panel is open', async ($, on) => {
    const fake = fakeEngine(on, repo({ phase: 'intake', slice: '0' }), 'feat/login')
    fake.answers.push(GATE.approve, MODELS.perStep)
    await start($)
    await submitPrompt($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Users sign in.' })

    expect(fake.opened).toHaveLength(1)
    expect((await bandLines($)).detail).toContain('waiting for you')
  })

  test('names the build sub-step from the lock: writing tests, then tests locked', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [TEST_FILE]: "it('totals', () => expect(total()).toBe(30))\n" }), 'feat/login')
    await start($)
    const writing = (await bandLines($)).detail

    await lockedSlice($, fake)

    expect(writing).toContain('build 1/2: writing tests')
    expect((await bandLines($)).detail).toContain('build 1/2: tests locked')
  })

  test("says a slice is verified until the build agent's run ends", async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [TEST_FILE]: "it('totals', () => expect(total()).toBe(30))\n" }), 'feat/login')
    fake.answers.push(NEXT_SLICE.stop)
    await start($)
    await lockedSlice($, fake, 'a1')
    await greenChecks($, fake)

    await $.tool.call({ tool: 'mcp__workflow__verify', agentId: 'a1' })
    const verified = (await bandLines($)).detail
    await turnEnds($, 'a1')
    await fake.clock.settle()

    expect(verified).toContain('slice 1 verified')
    expect((await bandLines($)).detail).toContain('build 2/2: writing tests')
  })

  test('names the inspect sub-step review', async ($, on) => {
    fakeEngine(on, repo({ phase: 'inspect' }), 'feat/login')
    await start($)

    expect((await bandLines($)).detail).toContain('inspect: review')
  })

  test('in a narrow terminal shortens the sub-step and keeps whether it waits for you whole', () => {
    const line = detailLine(view({ step: { name: 'proposing options to the user in a dialog', number: 3, count: 6 } }), 'waiting', 40)

    expect(line.activity).toBe('waiting for you')
    expect(`${line.lead}${line.activity}`.length).toBeLessThanOrEqual(40)
    expect(line.lead.startsWith('design 3/6')).toBe(true)
  })

  test('in a wide terminal reads sub-step, model and activity in that order', () => {
    const line = detailLine(view(), 'working', 100)

    expect(`${line.lead}${line.activity}`).toMatch(/^design 3\/6: proposing options.*opus high.*working$/)
  })
})

describe('the status line', () => {
  test('shows the step, the slice when building, the model and working', async ($, on) => {
    const fake = fakeEngine(on, repo(), 'feat/login')
    await start($)

    await submitPrompt($)

    expect(fake.statuses.at(-1)).toBe('workflow login: build 1/2, opus medium, working')
  })

  test('shows the conversation and waiting for you in the intake', async ($, on) => {
    const fake = fakeEngine(on, repo({ phase: 'intake', slice: '0' }), 'feat/login')
    await start($)

    await submitPrompt($)
    await turnEnds($)

    expect(fake.statuses.at(-1)).toBe('workflow login: intake, conversation, waiting for you')
  })

  test('is built from the same data as the band', () => {
    expect(statusText(view({ phase: 'build', slice: { number: 2, count: 5 }, step: { name: 'tests locked' }, runner: 'opus medium' }), 'waiting')).toBe(
      'workflow login: build 2/5, opus medium, waiting for you',
    )
  })
})
