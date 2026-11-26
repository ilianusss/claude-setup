import { describe, expect, test } from 'claude-code/testing'

import type { Slice } from '../src/slices'
import { parseSlices, readySlices, sections, tickSlice, waves } from '../src/slices'

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

describe('parseSlices dependencies', () => {
  const withLine = (line: string) => `## Slice 2: Next\n- [ ] Done\n\nGoal: x.\n${line}\n`

  test('tells a slice without a Depends on line from one that depends on none', () => {
    expect(parseSlices(SLICES).map(found => found.declaresDependencies)).toEqual([false, false])
    expect(parseSlices(withLine('Depends on: none'))[0]?.declaresDependencies).toBe(true)
  })

  test('a slice without a Depends on line depends on nothing', () => {
    expect(parseSlices(SLICES).map(slice => slice.dependsOn)).toEqual([[], []])
  })

  test('none, in any case, depends on nothing', () => {
    expect(parseSlices(withLine('Depends on: None'))[0]?.dependsOn).toEqual([])
    expect(parseSlices(withLine('Depends on: none'))[0]?.dependsOn).toEqual([])
  })

  test('reads slice numbers written as Slice N', () => {
    expect(parseSlices(withLine('Depends on: Slice 1, Slice 3'))[0]?.dependsOn).toEqual([1, 3])
  })

  test('reads bare slice numbers', () => {
    expect(parseSlices(withLine('Depends on: 1, 3'))[0]?.dependsOn).toEqual([1, 3])
  })

  test('keeps an entry it cannot read as a slice number apart, instead of dropping it', () => {
    const [parsed] = parseSlices(withLine('Depends on: Slice 1, Slice A, the login slice'))

    expect(parsed?.dependsOn).toEqual([1])
    expect(parsed?.unreadDependencies).toEqual(['Slice A', 'the login slice'])
  })
})

function slice(number: number, dependsOn: number[], done = false): Slice {
  return { number, name: `S${number}`, done, text: '', designSections: [], dependsOn, unreadDependencies: [], declaresDependencies: true }
}

describe('waves', () => {
  test('names a dependency it cannot read, so the gate refuses it', () => {
    const graph = [slice(1, []), { ...slice(2, [1]), unreadDependencies: ['Slice A'] }]

    expect(waves(graph)).toEqual({ errors: ['slice 2 depends on "Slice A", which is not a slice number (write "Slice N" or "none")'] })
  })

  test('groups slices by dependency level, in slice order', () => {
    const graph = [slice(1, []), slice(2, [1]), slice(3, [1]), slice(4, [2, 3]), slice(5, [])]

    expect(waves(graph)).toEqual({ waves: [[1, 5], [2, 3], [4]] })
  })

  test('names a dependency on a slice that does not exist', () => {
    expect(waves([slice(1, []), slice(2, [7])])).toEqual({ errors: ['slice 2 depends on slice 7, which does not exist'] })
  })

  test('names each slice that has no Depends on line, so the gate refuses it', () => {
    expect(waves([slice(1, []), { ...slice(2, []), declaresDependencies: false }])).toEqual({
      errors: ['slice 2 has no Depends on line: write the slices it needs, or none'],
    })
  })

  test('names a slice that depends on itself', () => {
    expect(waves([slice(1, [1])])).toEqual({ errors: ['slice 1 depends on itself'] })
  })

  test('names a cycle once, from its smallest slice', () => {
    expect(waves([slice(1, []), slice(3, [2]), slice(2, [3])])).toEqual({ errors: ['slices 2 -> 3 -> 2 depend on each other in a cycle'] })
  })

  test('names each of two cycles and not the slice that only waits on one', () => {
    const graph = [slice(1, [2]), slice(2, [1]), slice(3, [4]), slice(4, [3]), slice(5, [1])]

    expect(waves(graph)).toEqual({
      errors: ['slices 1 -> 2 -> 1 depend on each other in a cycle', 'slices 3 -> 4 -> 3 depend on each other in a cycle'],
    })
  })
})

describe('readySlices', () => {
  const graph = [slice(1, [], true), slice(2, [1]), slice(3, [1]), slice(4, [2]), slice(5, [1])]

  test('returns the not-done slices whose dependencies are done', () => {
    expect(readySlices(graph, [], 9).map(ready => ready.number)).toEqual([2, 3, 5])
  })

  test('leaves out the running slices', () => {
    expect(readySlices(graph, [2], 9).map(ready => ready.number)).toEqual([3, 5])
  })

  test('leaves out a slice with no Depends on line, or a dependency it cannot read', () => {
    const unclear = [slice(1, [], true), { ...slice(2, []), declaresDependencies: false }, { ...slice(3, []), unreadDependencies: ['the login slice'] }, slice(4, [1])]

    expect(readySlices(unclear, [], 9).map(ready => ready.number)).toEqual([4])
  })

  test('returns at most max slices, the first in slice order', () => {
    expect(readySlices(graph, [], 2).map(ready => ready.number)).toEqual([2, 3])
  })
})

describe('tickSlice', () => {
  test("ticks the Done line of the slice it names, and only that one", () => {
    const ticked = tickSlice(SLICES.replace('- [x] Done', '- [ ] Done'), 2) ?? ''

    expect(parseSlices(ticked).map(found => found.done)).toEqual([false, true])
  })

  test('changes nothing else in the file', () => {
    expect(tickSlice(SLICES, 2)).toBe(SLICES.replace('## Slice 2: Password check\n- [ ] Done', '## Slice 2: Password check\n- [x] Done'))
  })

  test('returns nothing for a slice that is ticked already or does not exist', () => {
    expect(tickSlice(SLICES, 1)).toBeUndefined()
    expect(tickSlice(SLICES, 7)).toBeUndefined()
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
