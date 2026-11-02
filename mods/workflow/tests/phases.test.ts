import { describe, expect, test } from 'claude-code/testing'

import { GATE } from '../src/labels'
import { parseWorkflow } from '../src/state'
import { ROOT, STATE_DIR, buildRepo, fakeEngine, start, stateText } from './engine'

const DESIGN = buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ phase: 'design', slice: '0' }) })

function state(files: Map<string, string>) {
  return parseWorkflow(files.get(`${STATE_DIR}/login.md`) ?? '')
}

function text(ran: { deny?: string; result?: unknown }): string {
  return ran.deny ?? String(ran.result)
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
  test('advance asks the person and moves the phase on approval', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.approve)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B: sessions in Redis.' })

    expect(fake.questions[0]).toContain('Option B: sessions in Redis.')
    expect(state(fake.files).phase).toBe('slice')
    expect(text(ran)).toContain('/workflow next')
  })

  test('advance changes nothing when the person says not yet', async ($, on) => {
    const fake = fakeEngine(on, DESIGN, 'feat/login')
    fake.answers.push(GATE.wait)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B.' })

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
