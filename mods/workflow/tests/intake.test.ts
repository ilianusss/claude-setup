import { describe, expect, test } from 'claude-code/testing'

import { GATE } from '../src/labels'
import { parseWorkflow } from '../src/state'
import { ROOT, STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'

const STATE_FILE = `${STATE_DIR}/login.md`
const INTAKE = buildRepo({ [STATE_FILE]: stateText({ phase: 'intake', slice: '0' }) })
const GOAL = 'Users sign in with email and password; success is a working session; no SSO.'
const GATE_SUMMARY = 'Users sign in with email and password.'

function state(files: Map<string, string>) {
  return parseWorkflow(files.get(STATE_FILE) ?? '')
}

function withoutConfig(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => path !== `${ROOT}/.claude/workflow.json`))
}

describe('the intake gate', () => {
  test('moves to setup when the project has no workflow.json', async ($, on) => {
    const fake = fakeEngine(on, withoutConfig(INTAKE), 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: GATE_SUMMARY })

    expect(state(fake.files).phase).toBe('setup')
  })

  test('moves a feature to design when the project has its workflow.json', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: GATE_SUMMARY })

    expect(state(fake.files).phase).toBe('design')
  })

  test('moves a project to spec when the project has its workflow.json', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ size: 'project', phase: 'intake', slice: '0' }) }), 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: GATE_SUMMARY })

    expect(state(fake.files).phase).toBe('spec')
  })
})

describe('the goal in the handoff', () => {
  test('in the intake phase is saved as the Goal section', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__handoff', stopped: 'Goal confirmed.', next: 'Approve the intake.', goal: GOAL })

    expect(ran.deny).toBeUndefined()
    expect(state(fake.files)).toMatchObject({ goal: GOAL, stopped: 'Goal confirmed.' })
    expect(fake.files.get(STATE_FILE)).toContain(`## Goal\n\n${GOAL}\n`)
  })

  test('outside the intake phase is refused and nothing is saved', async ($, on) => {
    const design = buildRepo({ [STATE_FILE]: stateText({ phase: 'design', slice: '0' }) })
    const fake = fakeEngine(on, design, 'feat/login')
    await start($)
    const before = fake.files.get(STATE_FILE)

    const ran = await $.tool.call({ tool: 'mcp__workflow__handoff', stopped: 'Design written.', next: 'Approve it.', goal: GOAL })

    expect(ran.deny).toContain('intake')
    expect(fake.files.get(STATE_FILE)).toBe(before)
  })
})

describe('a phase that lists no writes', () => {
  test('refuses a Write to source code', async ($, on) => {
    fakeEngine(on, INTAKE, 'feat/login')
    await start($)

    const ran = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/login.ts`, content: 'export {}' })

    expect(ran.deny).toContain('intake')
  })

  test("refuses a Write to the workflow's own documents", async ($, on) => {
    fakeEngine(on, INTAKE, 'feat/login')
    await start($)

    const ran = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/docs/specs/login/notes.md`, content: '# Notes' })

    expect(ran.deny).toContain('intake')
  })

  test('refuses an Edit to the project CLAUDE.md', async ($, on) => {
    fakeEngine(on, { ...INTAKE, [`${ROOT}/CLAUDE.md`]: '# Project' }, 'feat/login')
    await start($)

    const ran = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/CLAUDE.md`, old_string: 'Project', new_string: 'App' })

    expect(ran.deny).toContain('intake')
  })

  test('gives a shell command that changes a file a note naming it', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.shellWrites.set('echo x > notes.md', { 'notes.md': 'x' })
    await start($)

    const ran = await $.tool.call({ tool: 'Bash', command: 'echo x > notes.md' })

    expect((ran.context ?? []).join('\n')).toContain('notes.md')
    expect((ran.context ?? []).join('\n')).toContain('intake phase')
  })
})

describe('the intake prompt', () => {
  test('asks the problem, the result, how success shows, the limits and the scope, then a restatement to confirm', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    await start($)

    await run($, 'continue')
    await fake.clock.settle()

    const prompt = fake.prompts[0] ?? ''
    const order = ['The problem', 'The result wanted', 'How success will show', 'The limits', 'Out of scope', 'Restate', 'confirm']
    const positions = order.map(phrase => prompt.indexOf(phrase))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  test('saves the confirmed goal with the handoff, then asks for the gate', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    await start($)

    await run($, 'continue')
    await fake.clock.settle()

    const prompt = fake.prompts[0] ?? ''
    const handoff = prompt.indexOf('mcp__workflow__handoff with `goal`')
    expect(handoff).toBeGreaterThan(prompt.indexOf('Restate'))
    expect(prompt.indexOf('mcp__workflow__advance', handoff)).toBeGreaterThan(handoff)
  })
})
