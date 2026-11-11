import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_PLAN, parsePlan, renderPlan } from '../src/plan'

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
