import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import type { WorkflowBanner } from '../types'
import { bandLine } from '../src/banner'
import { GATE, MODELS, NEXT_SLICE, SWITCH } from '../src/labels'
import { statusText } from '../src/status'
import { HINT_LINE, PROMPT_HINT, ROOT, STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'
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
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

function repo(fields: Partial<Record<string, string>> = {}): Record<string, string> {
  return buildRepo({ [STATE_FILE]: stateText(fields) })
}

function withoutConfig(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => path !== `${ROOT}/.claude/workflow.json`))
}

function mountBand($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  return surface === 'terminal' ? $.ui.mount(PROMPT_HINT) : $.ui.mount({ ...BAND, surface })
}

async function bandText($: Engine, surface: 'terminal' | 'desktop' = 'terminal'): Promise<string> {
  const ui = await mountBand($, surface)
  const text = (await ui.find({ type: 'Text', text: /working|waiting for you/ }))?.text ?? ''
  await ui.unmount()
  return text
}

async function bandBox(ui: Pick<Mounted, 'findAll'>) {
  return (await ui.findAll({ type: 'Box' })).find(box => box.props.borderStyle === 'round')
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

describe('where the band is drawn', () => {
  test('on the terminal, draws the band under the prompt, after the hint line the engine and other mods drew', async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    await start($)

    const ui = await $.ui.mount(PROMPT_HINT)
    const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)

    expect(texts[0]).toBe(HINT_LINE)
    expect(texts.some(text => /intake.*design.*waiting for you/.test(text))).toBe(true)
    await ui.unmount()
  })

  test('on the terminal, draws one line in a round border as wide as the hint row', async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    await start($)

    const ui = await $.ui.mount(PROMPT_HINT)
    const box = await bandBox(ui)

    expect(box?.props.width).toBe(100)
    expect(box?.children).toHaveLength(1)
    expect(box?.children[0]).toMatchObject({ type: 'Text', props: { wrap: 'truncate-end' } })
    await ui.unmount()
  })

  test('on a terminal that has not measured its width yet, sizes the band to 80 columns', async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    await start($)

    const { viewport: _, ...unmeasured } = PROMPT_HINT
    const ui = await $.ui.mount(unmeasured)

    expect((await bandBox(ui))?.props.width).toBe(75)
    await ui.unmount()
  })

  test('on the terminal, draws nothing above the prompt any more', async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    await start($)

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

    expect(await ui.find({ type: 'Text' })).toBeUndefined()
    await ui.unmount()
  })

  test('on the desktop, draws one line in a round border above the prompt and leaves the hint line alone', async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    await start($)

    const above = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const box = await bandBox(above)
    await above.unmount()
    const hint = await $.ui.mount({ ...PROMPT_HINT, surface: 'desktop' })
    const hintTexts = (await hint.findAll({ type: 'Text' })).map(text => text.text)
    await hint.unmount()

    expect(box?.children).toHaveLength(1)
    expect(box?.children[0]).toMatchObject({ type: 'Text', props: { wrap: 'truncate-end' } })
    expect(hintTexts).toEqual([HINT_LINE])
  })

  test('without a workflow on this branch, leaves the hint line alone and draws nothing above the prompt', async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'main')
    await start($)

    const hint = await $.ui.mount(PROMPT_HINT)
    const hintTexts = (await hint.findAll({ type: 'Text' })).map(text => text.text)
    await hint.unmount()
    const above = await $.ui.mount({ ...BAND, surface: 'desktop' })

    expect(hintTexts).toEqual([HINT_LINE])
    expect(await above.find({ type: 'Text' })).toBeUndefined()
    await above.unmount()
  })

  test('on the desktop, gives the band to a survey', async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    await start($)

    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'desktop' })

    expect(await ui.find({ type: 'Text' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('when the band shows', () => {
  test('at the start of a session on the branch of a current workflow, before any command', async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    await start($)

    expect(await bandText($)).toContain('design')
  })

  test('right after /workflow continue switches to the branch of the workflow', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'main')
    fake.answers.push(SWITCH.yes('feat/login'))
    await start($)
    const before = await bandText($)

    await run($, 'continue login')

    expect(before).toBe('')
    expect(await bandText($)).toContain('build 1/2: writing tests')
  })
})

describe('the steps on the band', () => {
  for (const surface of SURFACES) {
    test(`on ${surface}, lists the steps of a feature in pipeline order: finished ones in the success colour, the current one bold and coloured, later ones dim`, async ($, on) => {
      fakeEngine(on, repo({ phase: 'slice', slice: '0' }), 'feat/login')
      await start($)

      const ui = await mountBand($, surface)
      const line = (await ui.find({ type: 'Text', text: /intake/ }))?.text ?? ''
      const done = await Promise.all(['intake', 'design'].map(step => ui.find({ type: 'Text', text: new RegExp(`^${step}$`) })))
      const current = await ui.find({ type: 'Text', text: /^slice$/ })
      const later = await Promise.all(['build', 'inspect'].map(step => ui.find({ type: 'Text', text: new RegExp(`^${step}$`) })))

      expect(line).toMatch(/intake.*design.*slice.*build.*inspect/)
      expect(done.map(step => step?.props.color)).toEqual(['success', 'success'])
      expect(current?.props.weight).toBe('bold')
      expect(current?.props.color).toBe('suggestion')
      expect(current?.props.dimColor).not.toBe(true)
      expect(later.map(step => step?.props.dimColor)).toEqual([true, true])
      await ui.unmount()
    })

    test(`on ${surface}, shows no done marker on the steps already behind`, async ($, on) => {
      fakeEngine(on, repo({ phase: 'inspect' }), 'feat/login')
      await start($)

      const text = await bandText($, surface)

      expect(text).toMatch(/intake.*inspect/)
      expect(text).not.toMatch(DONE_MARKERS)
    })
  }

  test('in a wide terminal lists setup, spec and retro for a project that has no workflow.json yet', async ($, on) => {
    fakeEngine(on, withoutConfig(repo({ size: 'project', phase: 'intake', slice: '0' })), 'feat/login')
    await start($)

    const ui = await $.ui.mount({ ...PROMPT_HINT, viewport: { columns: 120, rows: 40 } })

    expect((await ui.find({ type: 'Text', text: /intake/ }))?.text).toMatch(/intake.*setup.*spec.*design.*slice.*build.*inspect.*retro/)
    await ui.unmount()
  })

  test('leaves setup out once the project has its workflow.json', async ($, on) => {
    fakeEngine(on, repo({ size: 'project', phase: 'spec', slice: '0' }), 'feat/login')
    await start($)

    const text = await bandText($)

    expect(text).toMatch(/intake.*spec.*design.*slice.*build.*inspect.*retro/)
    expect(text).not.toContain('setup')
  })

  test('shows the slice count on build', async ($, on) => {
    fakeEngine(on, repo(), 'feat/login')
    await start($)

    const ui = await mountBand($)

    expect((await ui.find({ type: 'Text', text: /^build 1\/2$/ }))?.props.weight).toBe('bold')
    await ui.unmount()
  })
})

describe('the details on the band', () => {
  test("names the model and effort of the step's agent, from the plan", async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0', models: '[design sonnet low]' }), 'feat/login')
    await start($)

    expect(await bandText($)).toContain('design · sonnet low · ')
  })

  test('says the intake runs in the conversation', async ($, on) => {
    fakeEngine(on, repo({ phase: 'intake', slice: '0' }), 'feat/login')
    await start($)

    expect(await bandText($)).toContain('conversation')
  })

  test('says working, dim, from a submitted prompt, then waiting for you in the warning colour once the turn completes', async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    await start($)

    await submitPrompt($)
    const working = await mountBand($)
    const workingText = await working.find({ type: 'Text', text: /^working$/ })
    await working.unmount()
    await turnEnds($)
    const waiting = await mountBand($)
    const waitingText = await waiting.find({ type: 'Text', text: /^waiting for you$/ })
    await waiting.unmount()

    expect(workingText?.props.dimColor).toBe(true)
    expect(waitingText?.props.color).toBe('warning')
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

    expect(await bandText($)).toContain('working')
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
    fake.answers.push(GATE.continue, MODELS.perStep)
    await start($)
    await submitPrompt($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Users sign in.' })

    expect(fake.opened).toHaveLength(1)
    expect(await bandText($)).toContain('waiting for you')
  })

  test('names the build sub-step from the lock: writing tests, then tests locked', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [TEST_FILE]: "it('totals', () => expect(total()).toBe(30))\n" }), 'feat/login')
    await start($)
    const writing = await bandText($)

    await lockedSlice($, fake)

    expect(writing).toContain('build 1/2: writing tests')
    expect(await bandText($)).toContain('build 1/2: tests locked')
  })

  test("says a slice is verified until the build agent's run ends", async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [TEST_FILE]: "it('totals', () => expect(total()).toBe(30))\n" }), 'feat/login')
    fake.answers.push(NEXT_SLICE.stop)
    await start($)
    await lockedSlice($, fake, 'a1')
    await greenChecks($, fake)

    await $.tool.call({ tool: 'mcp__workflow__verify', agentId: 'a1' })
    const verified = await bandText($)
    await turnEnds($, 'a1')
    await fake.clock.settle()

    expect(verified).toContain('slice 1 verified')
    expect(await bandText($)).toContain('build 2/2: writing tests')
  })

  test('names the inspect sub-step review', async ($, on) => {
    fakeEngine(on, repo({ phase: 'inspect' }), 'feat/login')
    await start($)

    expect(await bandText($)).toContain('inspect: review')
  })
})

describe('fitting the band in one line', () => {
  const working = { lead: 'design 3/6: proposing options · opus high · ', activity: 'working' }

  test('in a wide terminal lists every step with its state, then the sub-step, the model and the activity', () => {
    expect(bandLine(view(), 'working', 100)).toEqual({
      steps: [
        { label: 'intake', state: 'done' },
        { label: 'design', state: 'current' },
        { label: 'slice', state: 'next' },
        { label: 'build', state: 'next' },
        { label: 'inspect', state: 'next' },
      ],
      ...working,
    })
  })

  test('first drops the steps before the current one', () => {
    expect(bandLine(view(), 'working', 90)).toEqual({
      steps: [
        { label: '...', state: 'done' },
        { label: 'design', state: 'current' },
        { label: 'slice', state: 'next' },
        { label: 'build', state: 'next' },
        { label: 'inspect', state: 'next' },
      ],
      ...working,
    })
  })

  test('then drops the steps after it', () => {
    expect(bandLine(view(), 'working', 80)).toEqual({
      steps: [
        { label: '...', state: 'done' },
        { label: 'design', state: 'current' },
        { label: 'slice', state: 'next' },
        { label: '...', state: 'next' },
      ],
      ...working,
    })
  })

  test('then drops the list of steps, since the sub-step names the current one', () => {
    expect(bandLine(view(), 'working', 60)).toEqual({ steps: [], ...working })
  })

  test('then shortens the sub-step, keeping the model while the sub-step keeps a few letters', () => {
    expect(bandLine(view(), 'waiting', 50)).toEqual({ steps: [], lead: 'design 3/6: propo... · opus high · ', activity: 'waiting for you' })
  })

  test('in a narrow terminal drops the model and keeps the current step and whether it waits for you whole', () => {
    const line = bandLine(view({ phase: 'build', slice: { number: 2, count: 5 }, step: { name: 'tests locked' }, runner: 'opus medium' }), 'waiting', 40)

    expect(line).toEqual({ steps: [], lead: 'build 2/5: tests lo... · ', activity: 'waiting for you' })
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
