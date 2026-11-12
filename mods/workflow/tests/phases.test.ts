import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { GATE } from '../src/labels'
import { parseWorkflow } from '../src/state'
import { ROOT, STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'

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

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B.' })

    expect(offered).toEqual([['Continue', 'Stop here', 'Not yet']])
  })

  test('advance asks the person and moves the phase on approval', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.approve)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B: sessions in Redis.' })

    expect(fake.questions[0]).toContain('Option B: sessions in Redis.')
    expect(state(fake.files).phase).toBe('slice')
    expect(text(ran)).not.toContain('/workflow next')
  })

  test('Continue registers the agents, ends the turn and submits the next phase prompt in a turn of its own', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.approve)
    await start($)
    const registeredBefore = fake.agents.length

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B.' })
    const registeredByTheGate = fake.agents.length - registeredBefore
    const submittedDuringTheCall = fake.prompts.length
    await fake.clock.settle()

    expect(registeredByTheGate).toBeGreaterThan(0)
    expect(submittedDuringTheCall).toBe(0)
    expect(text(ran)).toContain('End your turn')
    expect(text(ran)).not.toContain('Do the slice work.')
    expect(fake.prompts).toHaveLength(1)
    expect(fake.prompts[0]).toContain('The slice phase')
    expect(fake.prompts[0]).toContain('Do the slice work.')
  })

  test('Continue into build submits the build prompt for the first slice not done', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ phase: 'slice', slice: '0' }) }), 'feat/login')
    fake.answers.push(GATE.approve)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Two slices.' })
    await fake.clock.settle()

    expect(text(ran)).not.toContain('Spawn `workflow:build`')
    expect(fake.prompts[0]).toEqual(expect.stringMatching(/Spawn `workflow:build`[^\n]*slice 1/))
    expect(fake.prompts[0]).toContain('Slice 1: Walking skeleton')
  })

  test('Continue out of the last phase closes the workflow', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ phase: 'inspect' }) }), 'feat/login')
    fake.answers.push(GATE.approve)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Pull request opened.' })

    expect(state(fake.files)).toMatchObject({ phase: 'done', status: 'done' })
    expect(text(ran)).toContain('done')
  })

  test('Stop here moves the phase and says to hand off and stop, naming /workflow continue', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.stop)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B.' })

    expect(state(fake.files).phase).toBe('slice')
    expect(text(ran)).toContain('mcp__workflow__handoff')
    expect(text(ran)).toContain('/workflow continue login')
    expect(text(ran)).not.toContain('Do the slice work.')
  })

  test('/workflow continue after Stop here submits the prompt of the phase it stopped in', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.stop)
    await start($)
    await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B.' })

    await run($, 'continue login')
    await fake.clock.settle()

    expect(fake.prompts).toHaveLength(1)
    expect(fake.prompts[0]).toContain('The slice phase')
  })

  test('advance changes nothing when the person says not yet', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.wait)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B.' })

    expect(state(fake.files).phase).toBe('design')
    expect(text(ran)).toContain('Ask what should change')
  })

  test('advance changes nothing when the person dismisses the dialog', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B.' })

    expect(state(fake.files).phase).toBe('design')
    expect(text(ran)).toContain('stays in its design phase')
  })

  test('advance from a step agent is refused without asking', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.approve)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B.', agentId: 'a1' })

    expect(ran.deny).toContain('only the conversation')
    expect(fake.questions).toHaveLength(0)
    expect(state(fake.files).phase).toBe('design')
  })

  test('advance into build starts at the first slice not done', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ phase: 'slice', slice: '0' }) }), 'feat/login')
    fake.answers.push(GATE.approve)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Two slices.' })

    expect(state(fake.files)).toMatchObject({ phase: 'build', slice: 1 })
  })

  test('the build phase moves on through verify, not advance', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'done' })

    expect(text(ran)).toContain('verify')
    expect(fake.questions).toHaveLength(0)
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
