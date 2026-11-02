import { describe, expect, test } from 'claude-code/testing'

import { parseSlices, sections } from '../src/slices'

const SLICES = `# Slices: login

## Slice 1: Walking skeleton
- [x] Done

Goal: a sign-in form posts to a stub route.
Design: Components

## Slice 2: Password check
- [ ] Done

Goal: wrong passwords are refused.
Acceptance criteria:
- WHEN the password is wrong THE SYSTEM SHALL answer 401.
Design: API contracts, Security model
`

const DESIGN = `# Design

## Components

The form and the route.

## API contracts

POST /login returns 200 or 401.

## Security model

Throttle after 5 failures.
`

describe('parseSlices', () => {
  test('reads each slice with its number, name, state and design sections', () => {
    expect(parseSlices(SLICES).map(({ number, name, done, designSections }) => ({ number, name, done, designSections }))).toEqual([
      { number: 1, name: 'Walking skeleton', done: true, designSections: ['Components'] },
      { number: 2, name: 'Password check', done: false, designSections: ['API contracts', 'Security model'] },
    ])
  })

  test('keeps the slice text for the prompt', () => {
    expect(parseSlices(SLICES)[1]?.text).toContain('WHEN the password is wrong THE SYSTEM SHALL answer 401.')
  })
})

describe('sections', () => {
  test('extracts the named sections of a document', () => {
    const text = sections(DESIGN, ['API contracts', 'Security model'])
    expect(text).toContain('POST /login returns 200 or 401.')
    expect(text).toContain('Throttle after 5 failures.')
    expect(text).not.toContain('The form and the route.')
  })
})
