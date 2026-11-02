import { describe, expect, mock, test } from 'claude-code/testing'

import { weakenings } from '../src/integrity'
import { engineBeneath } from './engine'

const TOPLEVEL = 'rev-parse --show-toplevel'
const DIFF = 'diff HEAD -U0 --no-color --no-ext-diff'

describe('weakenings', () => {
  test('finds an added .only', () => {
    expect(weakenings("it('adds', () => {})", "it.only('adds', () => {})")).toEqual(['added .only'])
  })

  test('finds an added skip in each language', () => {
    expect(weakenings('', 'xit("a", f)')).toEqual(['added xit/xdescribe/xtest'])
    expect(weakenings('', '@pytest.mark.skip(reason="x")')).toEqual(['added a pytest skip or xfail'])
    expect(weakenings('', 't.Skip("later")')).toEqual(['added t.Skip'])
    expect(weakenings('', '#[ignore]')).toEqual(['added #[ignore]'])
  })

  test('finds removed assertions', () => {
    expect(weakenings('expect(a).toBe(1)\nexpect(b).toBe(2)', 'expect(a).toBe(1)')).toEqual(['removed 1 assertion'])
  })

  test('finds a changed existing assertion', () => {
    expect(weakenings('expect(total).toBe(30)', 'expect(total).toBeGreaterThan(0)')).toEqual([
      'changed 1 existing assertion',
    ])
  })

  test('finds nothing when assertions are only added', () => {
    expect(weakenings('expect(a).toBe(1)', 'expect(a).toBe(1)\nexpect(b).toBe(2)')).toEqual([])
  })
})

describe('edits to test files', () => {
  test('an Edit that adds .only to a test file gets a note', async ($, on) => {
    engineBeneath(on, { git: { [TOPLEVEL]: '/r\n' } })
    await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
    const ran = await $.tool.call({ tool: 'Edit', file_path: '/r/src/cart.test.ts', old_string: "it('a'", new_string: "it.only('a'" })
    expect(ran.context?.join('\n')).toContain('src/cart.test.ts: added .only')
  })

  test('the same edit to a source file gets no note', async ($, on) => {
    engineBeneath(on, { git: { [TOPLEVEL]: '/r\n' } })
    await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
    const ran = await $.tool.call({ tool: 'Edit', file_path: '/r/src/cart.ts', old_string: "it('a'", new_string: "it.only('a'" })
    expect(ran.context).toBeUndefined()
  })

  test('a test glob from workflow.json counts as a test file', async ($, on) => {
    engineBeneath(on, {
      git: { [TOPLEVEL]: '/r\n' },
      files: { '/r/.claude/workflow.json': JSON.stringify({ testGlobs: ['checks/**'] }) },
    })
    await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
    const ran = await $.tool.call({ tool: 'Edit', file_path: '/r/checks/cart.lua', old_string: 'assert(x)', new_string: '' })
    expect(ran.context?.join('\n')).toContain('removed 1 assertion')
  })
})

describe('end of turn', () => {
  const SHELL_DIFF = [
    'diff --git a/src/cart.test.ts b/src/cart.test.ts',
    '--- a/src/cart.test.ts',
    '+++ b/src/cart.test.ts',
    '@@ -4 +3,0 @@',
    '-  expect(total).toBe(30)',
    '',
  ].join('\n')

  test('a test weakened through the shell queues one follow-up', async ($, on) => {
    engineBeneath(on, { git: { [TOPLEVEL]: '/r\n', [DIFF]: SHELL_DIFF } })
    const clock = mock.clock(on)
    const prompts: string[] = []
    on('prompt.submit', (_, e) => {
      prompts.push(e.text)
      return { text: e.text }
    })
    on('turn.complete', (_, e) => ({ text: e.answer }))
    await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })

    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.settle()
    await $.turn.complete({ answer: 'done again', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    await clock.settle()

    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('src/cart.test.ts: removed 1 assertion')
  })

  test('a clean diff queues nothing', async ($, on) => {
    engineBeneath(on, { git: { [TOPLEVEL]: '/r\n', [DIFF]: '' } })
    const clock = mock.clock(on)
    const prompts: string[] = []
    on('prompt.submit', (_, e) => {
      prompts.push(e.text)
      return { text: e.text }
    })
    on('turn.complete', (_, e) => ({ text: e.answer }))
    await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })

    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.settle()

    expect(prompts).toHaveLength(0)
  })
})
