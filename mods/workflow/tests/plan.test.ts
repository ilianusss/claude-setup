import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_PLAN, parseChoice, parsePlan, parseRecommendations, renderPlan, withRecommendations } from '../src/plan'
import type { Step } from '../src/plan'

describe('the default plan', () => {
  test('gives each step the model and effort agreed in the design', () => {
    expect(DEFAULT_PLAN).toEqual({
      map: { model: 'sonnet', effort: 'medium' },
      setup: { model: 'sonnet', effort: 'medium' },
      spec: { model: 'opus', effort: 'high' },
      design: { model: 'opus', effort: 'high' },
      slice: { model: 'opus', effort: 'high' },
      build: { model: 'opus', effort: 'medium' },
      review: { model: 'opus', effort: 'high' },
    })
  })

  test('is what an empty list of entries reads as', () => {
    expect(parsePlan([])).toEqual(DEFAULT_PLAN)
  })

  test('fills in a step the entries leave out', () => {
    const plan = parsePlan(['build haiku low'])

    expect(plan.spec).toEqual({ model: 'opus', effort: 'high' })
    expect(plan.build).toEqual({ model: 'haiku', effort: 'low' })
  })
})

describe('rendering a plan', () => {
  test('writes one entry per step, in step order', () => {
    expect(renderPlan(DEFAULT_PLAN)).toEqual([
      'map sonnet medium',
      'setup sonnet medium',
      'spec opus high',
      'design opus high',
      'slice opus high',
      'build opus medium',
      'review opus high',
    ])
  })

  test('reads back as the same steps, models and efforts', () => {
    const plan = {
      ...DEFAULT_PLAN,
      design: { model: 'sonnet', effort: 'xhigh' },
      build: { model: 'haiku', effort: 'low' },
    } as const

    expect(parsePlan(renderPlan(plan))).toEqual(plan)
  })
})

describe('an entry the plan refuses', () => {
  test('naming Fable falls back to that step\'s default', () => {
    expect(parsePlan(['build fable medium']).build).toEqual({ model: 'opus', effort: 'medium' })
    expect(parsePlan(['build Fable medium']).build).toEqual({ model: 'opus', effort: 'medium' })
  })

  test('asking for max effort falls back to that step\'s default', () => {
    expect(parsePlan(['design opus max']).design).toEqual({ model: 'opus', effort: 'high' })
  })

  test('naming an unknown model or effort falls back to that step\'s default', () => {
    const plan = parsePlan(['map gpt-5 low', 'review sonnet extreme', 'setup', 'slice opus'])

    expect(plan.map).toEqual({ model: 'sonnet', effort: 'medium' })
    expect(plan.review).toEqual({ model: 'opus', effort: 'high' })
    expect(plan.setup).toEqual({ model: 'sonnet', effort: 'medium' })
    expect(plan.slice).toEqual({ model: 'opus', effort: 'high' })
  })

  test('leaves the valid entries beside it as they are', () => {
    const plan = parsePlan(['design sonnet low', 'build fable medium'])

    expect(plan.design).toEqual({ model: 'sonnet', effort: 'low' })
    expect(plan.build).toEqual({ model: 'opus', effort: 'medium' })
  })

  test('naming an unknown step changes nothing', () => {
    expect(parsePlan(['deploy haiku low'])).toEqual(DEFAULT_PLAN)
  })
})

const FEATURE_STEPS: Step[] = ['map', 'design', 'slice', 'build', 'review']

function errorsOf(input: unknown): string {
  const parsed = parseRecommendations(input, FEATURE_STEPS)
  return 'errors' in parsed ? parsed.errors.join('\n') : ''
}

describe('recommendations', () => {
  test('accept a known step, model and effort with a reason', () => {
    const parsed = parseRecommendations([{ step: 'build', model: 'sonnet', effort: 'high', reason: 'Small slices.' }], FEATURE_STEPS)

    expect(parsed).toEqual({ recommendations: [{ step: 'build', model: 'sonnet', effort: 'high', reason: 'Small slices.' }] })
  })

  test('accept an entry with no reason below xhigh', () => {
    const parsed = parseRecommendations([{ step: 'map', model: 'haiku', effort: 'low' }], FEATURE_STEPS)

    expect(parsed).toEqual({ recommendations: [{ step: 'map', model: 'haiku', effort: 'low', reason: '' }] })
  })

  test('keep a reason on one line', () => {
    const parsed = parseRecommendations([{ step: 'review', model: 'opus', effort: 'xhigh', reason: 'Auth code:\n  a subtle flaw costs most.' }], FEATURE_STEPS)

    expect(parsed).toEqual({ recommendations: [{ step: 'review', model: 'opus', effort: 'xhigh', reason: 'Auth code: a subtle flaw costs most.' }] })
  })

  test('refuse Fable, naming the entry', () => {
    expect(errorsOf([{ step: 'build', model: 'fable', effort: 'medium', reason: 'Best.' }])).toContain('build fable medium')
    expect(errorsOf([{ step: 'build', model: 'Fable', effort: 'medium', reason: 'Best.' }])).toContain('build Fable medium')
  })

  test('refuse max effort, naming the entry', () => {
    expect(errorsOf([{ step: 'design', model: 'opus', effort: 'max', reason: 'Hard.' }])).toContain('design opus max')
  })

  test('refuse xhigh without a reason, naming the entry', () => {
    expect(errorsOf([{ step: 'review', model: 'opus', effort: 'xhigh' }])).toContain('review opus xhigh')
    expect(errorsOf([{ step: 'review', model: 'opus', effort: 'xhigh', reason: '   ' }])).toContain('review opus xhigh')
  })

  test('refuse an unknown step, model or effort, naming the entry', () => {
    expect(errorsOf([{ step: 'deploy', model: 'opus', effort: 'high' }])).toContain('deploy opus high')
    expect(errorsOf([{ step: 'build', model: 'gpt-5', effort: 'high' }])).toContain('build gpt-5 high')
    expect(errorsOf([{ step: 'build', model: 'opus', effort: 'extreme' }])).toContain('build opus extreme')
  })

  test('refuse a step this workflow does not run', () => {
    expect(errorsOf([{ step: 'spec', model: 'opus', effort: 'medium' }])).toContain('spec opus medium')
  })

  test('refuse two entries for one step', () => {
    expect(errorsOf([
      { step: 'build', model: 'sonnet', effort: 'high' },
      { step: 'build', model: 'opus', effort: 'low' },
    ])).toContain('build')
  })

  test('refuse a value that is not a list of entries', () => {
    expect(errorsOf('build sonnet high')).not.toBe('')
    expect(errorsOf(['build sonnet high'])).not.toBe('')
    expect(errorsOf([{ step: 'build', model: 7, effort: 'high' }])).not.toBe('')
  })

  test('refuse the whole list when one entry is wrong', () => {
    const parsed = parseRecommendations(
      [{ step: 'build', model: 'sonnet', effort: 'high' }, { step: 'review', model: 'opus', effort: 'max' }],
      FEATURE_STEPS,
    )

    expect('recommendations' in parsed).toBe(false)
  })

  test('applied to a plan change only the steps they name', () => {
    const plan = withRecommendations(DEFAULT_PLAN, [{ step: 'build', model: 'sonnet', effort: 'high', reason: '' }])

    expect(plan).toEqual({ ...DEFAULT_PLAN, build: { model: 'sonnet', effort: 'high' } })
  })
})

describe('a choice typed by the user', () => {
  test('reads a model and an effort, in any case and spacing', () => {
    expect(parseChoice('sonnet high')).toEqual({ model: 'sonnet', effort: 'high' })
    expect(parseChoice('  Opus   XHIGH ')).toEqual({ model: 'opus', effort: 'xhigh' })
  })

  test('refuses Fable, max and anything else', () => {
    expect(parseChoice('fable high')).toBeUndefined()
    expect(parseChoice('opus max')).toBeUndefined()
    expect(parseChoice('sonnet')).toBeUndefined()
    expect(parseChoice('sonnet high please')).toBeUndefined()
    expect(parseChoice('')).toBeUndefined()
  })
})
