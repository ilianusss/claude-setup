import { describe, expect, test } from 'claude-code/testing'

import { GATE } from '../src/labels'
import { parseWorkflow } from '../src/state'
import { INTAKE_GOAL, INTAKE_POINTS, ROOT, STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'

const STATE_FILE = `${STATE_DIR}/login.md`
const INTAKE = buildRepo({ [STATE_FILE]: stateText({ phase: 'intake', slice: '0' }) })

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

    await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS })

    expect(state(fake.files).phase).toBe('setup')
  })

  test('moves a feature to design when the project has its workflow.json', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS })

    expect(state(fake.files).phase).toBe('design')
  })

  test('moves a project to spec when the project has its workflow.json', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ size: 'project', phase: 'intake', slice: '0' }) }), 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS })

    expect(state(fake.files).phase).toBe('spec')
  })
})

describe('the intake gate question', () => {
  test('is the restatement: the five points, a line each, under the approval line', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.wait)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS })

    expect(fake.questions).toEqual([`Approve the intake phase of "login" and move to design?\n\n${INTAKE_GOAL}`])
  })
})

describe('the goal saved by the intake gate', () => {
  test('on Continue is the five points, a line each, and reads back as the Goal section', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS })

    expect(state(fake.files).goal).toBe(INTAKE_GOAL)
    expect(fake.files.get(STATE_FILE)).toContain(`## Goal\n\n${INTAKE_GOAL}\n`)
  })

  test('on Stop here is the same', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.stop)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS })

    expect(state(fake.files)).toMatchObject({ status: 'paused', goal: INTAKE_GOAL })
  })

  test('on Not yet is not saved', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.wait)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS })

    expect(state(fake.files).goal).toBe('Users sign in.')
  })

  test('is not changed by a handoff that names a goal', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__handoff', stopped: 'Talking.', next: 'Approve the intake.', goal: 'Something else.' })

    expect(state(fake.files)).toMatchObject({ goal: 'Users sign in.', stopped: 'Talking.' })
  })
})

describe('a correction at the intake gate', () => {
  test('on Not yet tells Claude to amend the restatement from the answer and call advance again', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.wait)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS })

    expect(String(ran.result)).toContain('amend the restatement')
    expect(String(ran.result)).toContain('call mcp__workflow__advance again')
    expect(state(fake.files).phase).toBe('intake')
  })

  test('typed under Other is put in front of Claude to amend from', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push('The limit is no new dependency, but SSO is in scope')
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS })

    expect(String(ran.result)).toContain('The limit is no new dependency, but SSO is in scope')
    expect(String(ran.result)).toContain('amend the restatement')
    expect(state(fake.files).phase).toBe('intake')
  })
})

describe('the intake gate input it refuses', () => {
  const refused: Array<[string, Record<string, unknown>, string]> = [
    ['no point', {}, 'problem, result, success, limits, outOfScope'],
    ['an empty point', { ...INTAKE_POINTS, limits: '  ' }, 'limits'],
    ['a point that is not text', { ...INTAKE_POINTS, result: ['Users sign in.'] }, 'result'],
    ['a list field of the other phases', { ...INTAKE_POINTS, produced: ['The goal.'] }, 'produced'],
  ]
  for (const [name, input, named] of refused) {
    test(`with ${name} is refused before any dialog, naming what is wrong, and nothing moves`, async ($, on) => {
      const fake = fakeEngine(on, INTAKE, 'feat/login')
      fake.answers.push(GATE.continue)
      await start($)
      const before = fake.files.get(STATE_FILE)

      const ran = await $.tool.call({ tool: 'mcp__workflow__advance', ...input })

      expect(ran.deny).toContain(named)
      expect(ran.deny).toContain('nothing moved')
      expect(fake.questions).toHaveLength(0)
      expect(fake.files.get(STATE_FILE)).toBe(before)
    })
  }

  test('accepts "not stated" as a point', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS, outOfScope: 'not stated' })

    expect(ran.deny).toBeUndefined()
    expect(state(fake.files).goal).toContain('Out of scope: not stated')
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
  test("invites the user's own description first, then asks only the points it leaves out, then the gate that shows the restatement", async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    await start($)

    await run($, 'continue')
    await fake.clock.settle()

    const prompt = fake.prompts[0] ?? ''
    const order = ['in their own words', 'leaves out', 'The problem', 'The result wanted', 'How success will show', 'The limits', 'Out of scope', 'mcp__workflow__advance', 'confirms or corrects']
    const positions = order.map(phrase => prompt.indexOf(phrase))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  test('has no handoff step for the goal', async ($, on) => {
    const fake = fakeEngine(on, INTAKE, 'feat/login')
    await start($)

    await run($, 'continue')
    await fake.clock.settle()

    expect(fake.prompts[0]).not.toContain('mcp__workflow__handoff with `goal`')
  })
})
