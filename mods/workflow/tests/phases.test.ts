import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { GATE } from '../src/labels'
import { parseWorkflow } from '../src/state'
import { CONTINUE, ROOT, SLICES, STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'

const DESIGN = buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ phase: 'design', slice: '0' }) })

function state(files: Map<string, string>) {
  return parseWorkflow(files.get(`${STATE_DIR}/login.md`) ?? '')
}

function text(ran: { deny?: string; result?: unknown }): string {
  return ran.deny ?? String(ran.result)
}

function recordOptions(on: On): string[][] {
  const offered: string[][] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e, next) => {
    if (e.tool === 'AskUserQuestion') offered.push(e.questions[0]?.options.map(option => option.label) ?? [])
    return next(e)
  })
  return offered
}

describe('phase write scope', () => {
  test('in the design phase an Edit to source code is refused', async ($, on) => {
    fakeEngine(on, DESIGN, 'feat/login')
    await start($)

    const ran = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/login.ts`, content: 'export {}' })

    expect(ran.deny).toContain('design')
    expect(ran.deny).toContain('docs/specs/login/**')
  })

  test('in the design phase the spec folder and the ADRs are writable', async ($, on) => {
    fakeEngine(on, DESIGN, 'feat/login')
    await start($)

    const spec = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/docs/specs/login/design.md`, content: '# Design' })
    const adr = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/docs/adr/2026-10-22-sessions.md`, content: '# ADR' })

    expect(spec.deny).toBeUndefined()
    expect(adr.deny).toBeUndefined()
  })

  test('files outside the repo are not the phase guard\'s business', async ($, on) => {
    fakeEngine(on, DESIGN, 'feat/login')
    await start($)

    const ran = await $.tool.call({ tool: 'Write', file_path: '/tmp/scratch/notes.md', content: 'x' })

    expect(ran.deny).toBeUndefined()
  })

  test('another branch is not guarded by this workflow', async ($, on) => {
    fakeEngine(on, DESIGN, 'main')
    await start($)

    const ran = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/login.ts`, content: 'export {}' })

    expect(ran.deny).toBeUndefined()
  })

  test('the state folder is refused to Edit and Write', async ($, on) => {
    fakeEngine(on, DESIGN, 'feat/login')
    await start($)

    const ran = await $.tool.call({ tool: 'Write', file_path: `${STATE_DIR}/login.md`, content: 'phase: build' })

    expect(ran.deny).toContain('mcp__workflow__handoff')
  })
})

describe('gates', () => {
  test('advance offers Continue, Stop here and Not yet', async ($, on) => {
    const offered = recordOptions(on)
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.wait)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Option B.'] })

    expect(offered).toEqual([['Continue', 'Stop here', 'Not yet']])
  })

  test('advance asks the person and moves the phase on approval', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Option B: sessions in Redis.'] })

    expect(state(fake.files).phase).toBe('slice')
    expect(text(ran)).not.toContain('/workflow next')
  })

  test('advance asks the question the mod builds from the lists: the approval line, then each section that has items', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.wait)
    await start($)

    await $.tool.call({
      tool: 'mcp__workflow__advance',
      produced: ['design.md with three options', 'ADR 1'],
      decisions: ['Option B: sessions in Redis'],
      risks: ['Redis outage logs everyone out'],
      open: [],
    })

    expect(fake.questions).toEqual([
      [
        'Approve the design phase of "login" and move to slice?',
        '',
        'Produced:',
        '- design.md with three options',
        '- ADR 1',
        '',
        'Decisions:',
        '- Option B: sessions in Redis',
        '',
        'Risks:',
        '- Redis outage logs everyone out',
      ].join('\n'),
    ])
  })

  test('Continue registers the agents, fills /workflow continue and submits no prompt', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)
    const registeredBefore = fake.agents.length

    await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Option B.'] })
    await fake.clock.settle()

    expect(fake.agents.length - registeredBefore).toBeGreaterThan(0)
    expect(fake.fills).toEqual([CONTINUE])
    expect(fake.prompts).toHaveLength(0)
  })

  test('Continue tells Claude to end the turn with a Next: line that has the user run /workflow continue, and never say they have nothing to do', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Option B.'] })

    expect(text(ran)).toContain('now in its slice phase')
    expect(text(ran)).toContain('End your turn now')
    expect(text(ran)).toContain('"Next:"')
    expect(text(ran)).toContain('`/workflow continue` to start the slice phase')
    expect(text(ran)).toContain('already in their prompt box')
    expect(text(ran)).toContain('Never say the user has nothing to do')
    expect(text(ran)).not.toContain('Do the slice work.')
  })

  test('Continue goes on when the prompt box refuses /workflow continue, and tells Claude the user types it', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.fillMode = 'refuses'
    fake.answers.push(GATE.continue)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Option B.'] })

    expect(state(fake.files).phase).toBe('slice')
    expect(text(ran)).toContain('`/workflow continue` to start the slice phase')
    expect(text(ran)).toContain('they type it')
    expect(text(ran)).not.toContain('already in their prompt box')
  })

  test('Continue goes on when filling the prompt box fails: it is logged to debug and Claude is told the user types it', async ($, on) => {
    const logged: Array<{ text: string; to: string }> = []
    on('ui.log', (_, e) => {
      logged.push({ text: e.text, to: e.to })
      return { value: undefined }
    })
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.fillMode = 'breaks'
    fake.answers.push(GATE.continue)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Option B.'] })

    expect(state(fake.files).phase).toBe('slice')
    expect(text(ran)).toContain('they type it')
    expect(logged.filter(line => line.to === 'debug').map(line => line.text).join('\n')).toContain('could not be put in the prompt box')
  })

  test('/workflow continue after Continue submits the prompt of the phase the gate moved to', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)
    await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Option B.'] })

    await run($, 'continue')
    await fake.clock.settle()

    expect(fake.prompts).toHaveLength(1)
    expect(fake.prompts[0]).toContain('The slice phase')
    expect(fake.prompts[0]).toContain('Do the slice work.')
  })

  test('Continue into build moves to the first slice not done, and /workflow continue then submits its build prompt', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ phase: 'slice', slice: '0' }) }), 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Two slices.'] })
    await run($, 'continue')
    await fake.clock.settle()

    expect(text(ran)).not.toContain('Spawn `workflow:build`')
    expect(fake.prompts[0]).toEqual(expect.stringMatching(/Spawn `workflow:build`[^\n]*slice 1/))
    expect(fake.prompts[0]).toContain('Slice 1: Walking skeleton')
  })

  test('advance out of the slice phase is refused, and nothing moves, when slices.md has a bad dependency graph', async ($, on) => {
    const slices = SLICES.replace('Depends on: none', 'Depends on: Slice 2')
    const fake = fakeEngine(
      on,
      buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ phase: 'slice', slice: '0' }), [`${ROOT}/docs/specs/login/slices.md`]: slices }),
      'feat/login',
    )
    fake.answers.push(GATE.continue)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Two slices.'] })

    expect(ran.deny).toContain('slices 1 -> 2 -> 1 depend on each other in a cycle')
    expect(ran.deny).toContain('nothing moved')
    expect(ran.deny).toContain('slices.md')
    expect(fake.questions).toHaveLength(0)
    expect(state(fake.files).phase).toBe('slice')
  })

  test('advance out of the slice phase moves on when the dependencies form a graph', async ($, on) => {
    const slices = SLICES
    const fake = fakeEngine(
      on,
      buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ phase: 'slice', slice: '0' }), [`${ROOT}/docs/specs/login/slices.md`]: slices }),
      'feat/login',
    )
    fake.answers.push(GATE.continue)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Two slices.'] })

    expect(state(fake.files).phase).toBe('build')
  })

  test('Continue out of the last phase closes the workflow', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ phase: 'inspect' }) }), 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Pull request opened.'] })

    expect(state(fake.files)).toMatchObject({ phase: 'done', status: 'done' })
    expect(text(ran)).toContain('done')
  })

  test('Stop here moves the phase and says to hand off and stop, naming /workflow continue', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.stop)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Option B.'] })

    expect(state(fake.files).phase).toBe('slice')
    expect(text(ran)).toContain('mcp__workflow__handoff')
    expect(text(ran)).toContain('/workflow continue login')
    expect(text(ran)).not.toContain('Do the slice work.')
    expect(fake.fills).toEqual([])
  })

  test('/workflow continue after Stop here submits the prompt of the phase it stopped in', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.stop)
    await start($)
    await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Option B.'] })

    await run($, 'continue login')
    await fake.clock.settle()

    expect(fake.prompts).toHaveLength(1)
    expect(fake.prompts[0]).toContain('The slice phase')
  })

  test('advance changes nothing when the person says not yet', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.wait)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Option B.'] })

    expect(state(fake.files).phase).toBe('design')
    expect(text(ran)).toContain('Ask what should change')
  })

  test('advance asks what should change when the person types an answer under Other at a gate that is not the intake', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push('Add the Redis outage to the risks')
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Option B.'] })

    expect(state(fake.files).phase).toBe('design')
    expect(text(ran)).toContain('Add the Redis outage to the risks')
    expect(text(ran)).toContain('Ask what should change')
  })

  test('advance changes nothing when the person dismisses the dialog', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Option B.'] })

    expect(state(fake.files).phase).toBe('design')
    expect(text(ran)).toContain('stays in its design phase')
  })

  test('advance from a step agent is refused without asking', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Option B.'], agentId: 'a1' })

    expect(ran.deny).toContain('only the conversation')
    expect(fake.questions).toHaveLength(0)
    expect(state(fake.files).phase).toBe('design')
  })

  test('advance into build starts at the first slice not done', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ phase: 'slice', slice: '0' }) }), 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Two slices.'] })

    expect(state(fake.files)).toMatchObject({ phase: 'build', slice: 1 })
  })

  test('the build phase moves on through verify, not advance', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['done'] })

    expect(text(ran)).toContain('verify')
    expect(fake.questions).toHaveLength(0)
  })
})

describe('the gate input of a phase it refuses', () => {
  const refused: Array<[string, Record<string, unknown>, string]> = [
    ['no produced', { decisions: ['Option B.'] }, 'produced'],
    ['an empty produced', { produced: [] }, 'produced'],
    ['a produced of blank lines', { produced: ['  ', ''] }, 'produced'],
    ['a produced that is not a list', { produced: 'design.md' }, 'produced'],
    ['the intake points', { produced: ['design.md'], problem: 'Users cannot sign in.' }, 'problem'],
    ['the old summary only', { summary: 'Option B.' }, 'produced'],
  ]
  for (const [name, input, named] of refused) {
    test(`with ${name} is refused before any dialog, naming what is wrong, and nothing moves`, async ($, on) => {
      const fake = fakeEngine(on, DESIGN, 'feat/login')
      fake.answers.push(GATE.continue)
      await start($)
      const before = fake.files.get(`${STATE_DIR}/login.md`)

      const ran = await $.tool.call({ tool: 'mcp__workflow__advance', ...input })

      expect(ran.deny).toContain(named)
      expect(ran.deny).toContain('nothing moved')
      expect(fake.questions).toHaveLength(0)
      expect(fake.fills).toEqual([])
      expect(fake.files.get(`${STATE_DIR}/login.md`)).toBe(before)
    })
  }

  test('with technical decisions off is refused as well, since the gate moves without a dialog', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ phase: 'design', slice: '0', technical: 'no' }) }), 'feat/login')
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance' })

    expect(ran.deny).toContain('produced')
    expect(state(fake.files).phase).toBe('design')
  })
})

describe('handoff', () => {
  test('saves where things stopped, the next action and the open questions', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    await start($)

    await $.tool.call({
      tool: 'mcp__workflow__handoff',
      stopped: 'Options compared.',
      next: 'Ask the user to choose.',
      questions: ['Redis or Postgres?'],
    })

    expect(state(fake.files)).toMatchObject({ stopped: 'Options compared.', next: 'Ask the user to choose.', questions: ['Redis or Postgres?'] })
  })

  test('from a step agent is refused and changes nothing', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__handoff', stopped: 'Agent stopped.', next: 'Nothing.', agentId: 'a1' })

    expect(ran.deny).toContain('only the conversation')
    expect(state(fake.files).next).toBe('Write slice 1 tests.')
  })

  test('records the folders the design touches, for the drift check', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__handoff', stopped: 'Design written.', next: 'Approve it.', paths: ['src/auth', 'src/api'] })

    expect(state(fake.files).paths).toEqual(['src/auth', 'src/api'])
  })

  test('keeps the recorded folders when a handoff does not name any', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__handoff', stopped: 'Still designing.', next: 'Compare options.' })

    expect(state(fake.files).paths).toEqual(['src'])
  })
})

describe('phase write scope through the shell', () => {
  test('a shell command that changes code in the design phase gets a note naming the file', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.shellWrites.set("sed -i '' s/a/b/ src/login.ts", { 'src/login.ts': 'export const b = 1' })
    await start($)

    const ran = await $.tool.call({ tool: 'Bash', command: "sed -i '' s/a/b/ src/login.ts" })

    expect(ran.context?.join('\n')).toContain('src/login.ts')
    expect(ran.context?.join('\n')).toContain('design phase')
  })

  test('a shell command that writes the design documents gets no note', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.shellWrites.set('cat > docs/specs/login/design.md', { 'docs/specs/login/design.md': '# Login: design' })
    await start($)

    const ran = await $.tool.call({ tool: 'Bash', command: 'cat > docs/specs/login/design.md' })

    expect(ran.context ?? []).toHaveLength(0)
  })

  test('in the build phase a shell command may change code', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')
    fake.shellWrites.set("sed -i '' s/a/b/ src/login.ts", { 'src/login.ts': 'export const b = 1' })
    await start($)

    const ran = await $.tool.call({ tool: 'Bash', command: "sed -i '' s/a/b/ src/login.ts" })

    expect((ran.context ?? []).join('\n')).not.toContain('src/login.ts')
  })
})
