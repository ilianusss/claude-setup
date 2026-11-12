import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_PLAN } from '../src/plan'
import { parseWorkflow, phaseAfter, renderWorkflow, slugify, withLog } from '../src/state'
import type { Workflow } from '../src/state'
import { stateText } from './engine'

const WORKFLOW: Workflow = {
  slug: 'login',
  title: '[WIP] Add login: email and password',
  size: 'feature',
  phase: 'build',
  status: 'active',
  branch: 'feat/login',
  worktree: '/repo',
  slice: 3,
  commits: true,
  autoNext: false,
  models: { ...DEFAULT_PLAN, build: { model: 'haiku', effort: 'low' }, review: { model: 'sonnet', effort: 'xhigh' } },
  paths: ['src/auth', 'src/api'],
  session: 's1',
  updated: '2026-10-22T10:00:00.000Z',
  goal: 'Users sign in with email and password.',
  docs: ['docs/specs/login/design.md', 'docs/specs/login/slices.md'],
  stopped: 'Slice 3 tests are locked.',
  next: 'Implement the refresh endpoint.',
  questions: [],
  log: ['2026-10-20 created', '2026-10-21 design approved'],
}

describe('the state file', () => {
  test('round-trips through its markdown form', () => {
    expect(parseWorkflow(renderWorkflow(WORKFLOW))).toEqual(WORKFLOW)
  })

  test('reads as plain markdown with frontmatter', () => {
    const text = renderWorkflow(WORKFLOW)
    expect(text.startsWith('---\nslug: login\n')).toBe(true)
    expect(text).toContain('## Next action\n\nImplement the refresh endpoint.')
  })

  test('writes the model plan as one models line', () => {
    expect(renderWorkflow(WORKFLOW)).toContain(
      '\nmodels: [map sonnet medium, setup sonnet medium, spec opus high, design opus high, slice opus high, build haiku low, review sonnet xhigh]\n',
    )
  })

  test('a file without a models line reads as the default plan', () => {
    expect(parseWorkflow(stateText()).models).toEqual(DEFAULT_PLAN)
  })

  test('a models line sets the plan of the steps it names', () => {
    const workflow = parseWorkflow(stateText({ models: '[build haiku low]' }))

    expect(workflow.models).toEqual({ ...DEFAULT_PLAN, build: { model: 'haiku', effort: 'low' } })
  })

  test('a models entry naming Fable or max effort reads as that step\'s default', () => {
    const workflow = parseWorkflow(stateText({ models: '[build fable low, review opus max]' }))

    expect(workflow.models).toEqual(DEFAULT_PLAN)
  })

  test('refuses a file with an unknown phase', () => {
    const text = renderWorkflow(WORKFLOW).replace('phase: build', 'phase: coding')
    expect(() => parseWorkflow(text)).toThrow('phase')
  })

  test('keeps the last ten log entries', () => {
    let workflow = WORKFLOW
    for (let day = 1; day <= 12; day += 1) workflow = withLog(workflow, `2026-11-${day}`, `entry ${day}`)
    expect(workflow.log).toHaveLength(10)
    expect(workflow.log.at(-1)).toBe('2026-11-12 entry 12')
  })
})

describe('phases', () => {
  test('a feature goes design, slice, build, inspect, done', () => {
    expect(['design', 'slice', 'build', 'inspect'].map(phase => phaseAfter('feature', phase as Workflow['phase']))).toEqual([
      'slice',
      'build',
      'inspect',
      'done',
    ])
  })

  test('a project adds spec before design and retro after inspect', () => {
    expect(phaseAfter('project', 'spec')).toBe('design')
    expect(phaseAfter('project', 'inspect')).toBe('retro')
    expect(phaseAfter('project', 'retro')).toBe('done')
  })

  test('setup comes right after the intake only when the project has no workflow.json', () => {
    expect(phaseAfter('feature', 'intake', true)).toBe('setup')
    expect(phaseAfter('feature', 'intake', false)).toBe('design')
    expect(phaseAfter('project', 'intake', false)).toBe('spec')
    expect(phaseAfter('feature', 'setup')).toBe('design')
    expect(phaseAfter('project', 'setup')).toBe('spec')
  })
})

describe('slugify', () => {
  test('keeps lowercase words joined by hyphens', () => {
    expect(slugify('Add login: email & password!')).toBe('add-login-email-password')
  })

  test('caps the slug at five words', () => {
    expect(slugify('one two three four five six seven')).toBe('one-two-three-four-five')
  })
})
