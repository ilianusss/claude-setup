import { describe, expect, test } from 'claude-code/testing'

import { firstPhase, parseWorkflow, phaseAfter, renderWorkflow, slugify, withLog } from '../src/state'
import type { Workflow } from '../src/state'

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

  test('setup comes first only when the project has no workflow.json', () => {
    expect(firstPhase('feature', true)).toBe('setup')
    expect(firstPhase('feature', false)).toBe('design')
    expect(firstPhase('project', false)).toBe('spec')
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
