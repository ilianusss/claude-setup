import { describe, expect, test } from 'claude-code/testing'

import { gateQuestion, goalOf, parseGateSummary } from '../src/gate'
import type { GateSummary } from '../src/gate'
import { Refusal } from '../src/refusal'

const PHASE: GateSummary = {
  kind: 'phase',
  sections: {
    produced: ['design.md with three options', 'ADR 1: sessions in Redis'],
    decisions: ['Option B: sessions in Redis'],
    risks: [],
    open: ['Who rotates the keys?'],
  },
}

const INTAKE: GateSummary = {
  kind: 'intake',
  points: {
    problem: 'Users cannot sign in.',
    result: 'Users sign in with email and password.',
    success: 'A working session after sign-in.',
    limits: 'No new dependency.',
    outOfScope: 'not stated',
  },
}

describe('the gate question of a phase', () => {
  test('names the phase, the workflow and the target, then lists each section that has items, one dash line per item', () => {
    expect(gateQuestion(PHASE, 'design', 'login', 'slice')).toBe(
      [
        'Approve the design phase of "login" and move to slice?',
        '',
        'Produced:',
        '- design.md with three options',
        '- ADR 1: sessions in Redis',
        '',
        'Decisions:',
        '- Option B: sessions in Redis',
        '',
        'Open questions:',
        '- Who rotates the keys?',
      ].join('\n'),
    )
  })

  test('leaves out a section with no item', () => {
    const question = gateQuestion(PHASE, 'design', 'login', 'slice')

    expect(question).not.toContain('Risks:')
  })
})

describe('the gate question of the intake', () => {
  test('puts the five points on a line each, after a blank line', () => {
    expect(gateQuestion(INTAKE, 'intake', 'login', 'design')).toBe(
      [
        'Approve the intake phase of "login" and move to design?',
        '',
        'Problem: Users cannot sign in.',
        'Result: Users sign in with email and password.',
        'Success: A working session after sign-in.',
        'Limits: No new dependency.',
        'Out of scope: not stated',
      ].join('\n'),
    )
  })
})

describe('the goal of a gate', () => {
  test('is the five points of the intake, a line each', () => {
    expect(goalOf(INTAKE)).toBe(
      [
        'Problem: Users cannot sign in.',
        'Result: Users sign in with email and password.',
        'Success: A working session after sign-in.',
        'Limits: No new dependency.',
        'Out of scope: not stated',
      ].join('\n'),
    )
  })

  test('is none for the gate of another phase', () => {
    expect(goalOf(PHASE)).toBeUndefined()
  })
})

describe('the summary parsed from the input', () => {
  test('of a phase keeps the trimmed items and drops the empty ones', () => {
    const summary = parseGateSummary('design', 'login', { produced: ['  design.md  ', ''], decisions: [' ', 'Option B'] })

    expect(summary).toEqual({ kind: 'phase', sections: { produced: ['design.md'], decisions: ['Option B'], risks: [], open: [] } })
  })

  test('of the intake keeps each point on one line', () => {
    const summary = parseGateSummary('intake', 'login', {
      problem: 'Users\ncannot sign in.\n## Goal',
      result: 'r',
      success: 's',
      limits: 'l',
      outOfScope: 'o',
    })

    expect(summary).toMatchObject({ kind: 'intake', points: { problem: 'Users cannot sign in. ## Goal' } })
  })

  test('refuses a phase gate without produced, naming it and that nothing moved', () => {
    expect(() => parseGateSummary('design', 'login', { decisions: ['Option B'] })).toThrow(Refusal)
    expect(() => parseGateSummary('design', 'login', { produced: [' '] })).toThrow(/produced.*nothing moved/s)
  })
})

describe('the lists a gate takes', () => {
  test('refuses a section given as anything but a list', () => {
    expect(() => parseGateSummary('design', 'login', { produced: ['design.md'], decisions: 'Option B' })).toThrow(Refusal)
  })

  test('refuses produced given as a single line', () => {
    expect(() => parseGateSummary('design', 'login', { produced: 'design.md' })).toThrow('produced')
  })
})
