import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import type { WorkflowBanner } from '../types'
import { bandLine } from '../src/banner'
import { GATE, MODELS, NEXT_SLICE, SWITCH } from '../src/labels'
import { statusText } from '../src/status'
import { HINT_LINE, INTAKE_POINTS, PROMPT_HINT, ROOT, STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'
import type { Fake } from './engine'

const STATE_FILE = `${STATE_DIR}/login.md`
const TEST_FILE = `${ROOT}/src/cart.test.ts`
const RED = 'pnpm vitest run src/cart.test.ts'
const CHECKS = [RED, 'pnpm lint', 'pnpm tsc --noEmit', 'pnpm test']
const SURFACES = ['terminal', 'desktop'] as const
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

async function stepsText($: Engine, surface: 'terminal' | 'desktop' = 'terminal'): Promise<string> {
  const ui = await mountBand($, surface)
  const text = (await ui.find({ type: 'Text', text: /^│/ }))?.text ?? ''
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
    lanes: [],
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
    expect(texts.some(text => /^design.*waiting for you$/.test(text))).toBe(true)
    expect(texts.some(text => /^│ ✓ intake {2}● design/.test(text))).toBe(true)
    await ui.unmount()
  })

  test('on the terminal, draws one line in a round border as wide as the hint row', async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    await start($)

    const ui = await $.ui.mount(PROMPT_HINT)
    const box = await bandBox(ui)

    expect(box?.props.width).toBe(100)
    expect(box?.props.justifyContent).toBe('space-between')
    expect(box?.children).toHaveLength(2)
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

    expect(box?.children).toHaveLength(2)
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
    test(`on ${surface}, lists the steps of a feature in pipeline order on the right: finished ones with a check in the success colour, the current one with a dot, bold and coloured, later ones in the inactive colour`, async ($, on) => {
      fakeEngine(on, repo({ phase: 'slice', slice: '0' }), 'feat/login')
      await start($)

      const ui = await mountBand($, surface)
      const line = (await ui.find({ type: 'Text', text: /^│/ }))?.text ?? ''
      const done = await Promise.all(['intake', 'design'].map(step => ui.find({ type: 'Text', text: new RegExp(`^✓ ${step}$`) })))
      const current = await ui.find({ type: 'Text', text: /^● slice$/ })
      const later = await Promise.all(['build', 'inspect'].map(step => ui.find({ type: 'Text', text: new RegExp(`^${step}$`) })))

      expect(line).toBe('│ ✓ intake  ✓ design  ● slice  build  inspect')
      expect(done.map(step => step?.props.color)).toEqual(['success', 'success'])
      expect(current?.props.weight).toBe('bold')
      expect(current?.props.color).toBe('suggestion')
      expect(later.map(step => step?.props.color)).toEqual(['inactive', 'inactive'])
      await ui.unmount()
    })
  }

  test('draws the divider in the subtle colour at the start of the right section', async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    await start($)

    const ui = await mountBand($)

    expect((await ui.find({ type: 'Text', text: /^│$/ }))?.props.color).toBe('subtle')
    await ui.unmount()
  })

  test('names the current step on the right without its slice count', async ($, on) => {
    fakeEngine(on, repo(), 'feat/login')
    await start($)

    const ui = await $.ui.mount({ ...PROMPT_HINT, viewport: { columns: 140, rows: 40 } })
    const text = (await ui.find({ type: 'Text', text: /^│/ }))?.text
    await ui.unmount()

    expect(text).toBe('│ ✓ intake  ✓ design  ✓ slice  ● build  inspect')
  })

  test('in a wide terminal lists setup, spec and retro for a project that has no workflow.json yet', async ($, on) => {
    fakeEngine(on, withoutConfig(repo({ size: 'project', phase: 'intake', slice: '0' })), 'feat/login')
    await start($)

    const ui = await $.ui.mount({ ...PROMPT_HINT, viewport: { columns: 120, rows: 40 } })

    expect((await ui.find({ type: 'Text', text: /^│/ }))?.text).toMatch(/intake.*setup.*spec.*design.*slice.*build.*inspect.*retro/)
    await ui.unmount()
  })

  test('leaves setup out once the project has its workflow.json', async ($, on) => {
    fakeEngine(on, repo({ size: 'project', phase: 'spec', slice: '0' }), 'feat/login')
    await start($)

    const text = await stepsText($)

    expect(text).toMatch(/intake.*spec.*design.*slice.*build.*inspect.*retro/)
    expect(text).not.toContain('setup')
  })

  test('shows the slice count on build', async ($, on) => {
    fakeEngine(on, repo(), 'feat/login')
    await start($)

    const ui = await mountBand($)

    const head = await ui.find({ type: 'Text', text: /^build 1\/2$/ })

    expect(head?.props.weight).toBe('bold')
    expect(head?.props.color).toBe('claude')
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

  test('draws the phase with its counter bold in the claude colour, the sub-step in the text colour, the model in the permission colour and the separators in the subtle colour', async ($, on) => {
    fakeEngine(on, repo({ phase: 'intake', slice: '0', step: '2' }), 'feat/login')
    await start($)
    await submitPrompt($)

    const ui = await mountBand($)
    const head = await ui.find({ type: 'Text', text: /^intake 2\/5$/ })
    const detail = await ui.find({ type: 'Text', text: /^: listen$/ })
    const runner = await ui.find({ type: 'Text', text: /^conversation$/ })
    const separators = await ui.findAll({ type: 'Text', text: /^ · $/ })
    const activity = await ui.find({ type: 'Text', text: /^working$/ })
    await ui.unmount()

    expect([head?.props.color, head?.props.weight]).toEqual(['claude', 'bold'])
    expect(detail?.props.color).toBe('text')
    expect(runner?.props.color).toBe('permission')
    expect(separators.map(separator => separator.props.color)).toEqual(['subtle', 'subtle'])
    expect(activity?.props.color).toBe('planMode')
  })

  test('says working in the planMode colour from a submitted prompt, then waiting for you in the warning colour once the turn completes', async ($, on) => {
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

    expect(workingText?.props.color).toBe('planMode')
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

    await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Option B.'] })

    expect(seen[0]).toContain('waiting for you')
    expect(fake.statuses.at(-1)).toContain('working')
  })

  test('says waiting for you while the Models panel is open', async ($, on) => {
    const fake = fakeEngine(on, repo({ phase: 'intake', slice: '0' }), 'feat/login')
    fake.answers.push(GATE.continue, MODELS.perStep)
    await start($)
    await submitPrompt($)

    await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS })

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
  const left = { head: 'design 3/6', detail: ': proposing options', runner: 'opus high', activity: 'working' }
  const intake = { label: 'intake', state: 'done' } as const
  const design = { label: 'design', state: 'current' } as const
  const slice = { label: 'slice', state: 'next' } as const
  const build = { label: 'build', state: 'next' } as const
  const inspect = { label: 'inspect', state: 'next' } as const
  const before = { label: '...', state: 'done' } as const
  const after = { label: '...', state: 'next' } as const

  test('in a wide terminal lists every step with its state, then the sub-step, the model and the activity', () => {
    expect(bandLine(view(), 'working', 95)).toEqual({ left, steps: [intake, design, slice, build, inspect] })
  })

  test('first drops the steps before the current one', () => {
    expect(bandLine(view(), 'working', 90)).toEqual({ left, steps: [before, design, slice, build, inspect] })
  })

  test('then drops the steps after it', () => {
    expect(bandLine(view(), 'working', 80)).toEqual({ left, steps: [before, design, slice, after] })
  })

  test('then drops the list of steps, since the sub-step names the current one', () => {
    expect(bandLine(view(), 'working', 60)).toEqual({ left, steps: [] })
  })

  test('counts the check and the dot of the steps, the divider and the space before it', () => {
    expect(bandLine(view(), 'working', 94).steps).toEqual([before, design, slice, build, inspect])
    expect(bandLine(view(), 'working', 79).steps).toEqual([before, design, slice, after])
    expect(bandLine(view(), 'working', 52).steps).toEqual([])
  })

  test('then shortens the sub-step, keeping the model while the sub-step keeps a few letters', () => {
    expect(bandLine(view(), 'waiting', 52)).toEqual({ left: { head: 'design 3/6', detail: ': propo...', runner: 'opus high', activity: 'waiting for you' }, steps: [] })
  })

  test('in a narrow terminal drops the model and keeps the current step and whether it waits for you whole', () => {
    const line = bandLine(view({ phase: 'build', slice: { number: 2, count: 5 }, step: { name: 'tests locked' }, runner: 'opus medium' }), 'waiting', 42)

    expect(line).toEqual({ left: { head: 'build 2/5', detail: ': tests lo...', runner: '', activity: 'waiting for you' }, steps: [] })
  })

  test('draws the divider even when no step is left', async ($, on) => {
    fakeEngine(on, repo({ phase: 'design', slice: '0' }), 'feat/login')
    await start($)

    const ui = await $.ui.mount({ ...PROMPT_HINT, viewport: { columns: 60, rows: 40 } })

    const dividers = await ui.findAll({ type: 'Text', text: /^│$/ })
    await ui.unmount()

    expect(dividers.map(divider => divider.props.color)).toContain('subtle')
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

  test('names the slices building in lanes after the count of slices done', () => {
    expect(statusText(view({ phase: 'build', slice: { number: 2, count: 7 }, step: null, runner: 'opus medium', lanes: [5, 6, 7] }), 'working')).toBe(
      'workflow login: build 2/7: slices 5 6 7, opus medium, working',
    )
  })

  test('is built from the same data as the band', () => {
    expect(statusText(view({ phase: 'build', slice: { number: 2, count: 5 }, step: { name: 'tests locked' }, runner: 'opus medium' }), 'waiting')).toBe(
      'workflow login: build 2/5, opus medium, waiting for you',
    )
  })
})
