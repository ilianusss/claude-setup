import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BRANCH, CHAINING, COMMITS, GATE, SIZE } from '../src/labels'
import { CONFIG, ROOT, STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'
import type { Fake } from './engine'

const STATE_FILE = `${STATE_DIR}/login.md`
const LEADING = '## Leading the user'

type Logged = { text: string; to: string }

function recordLog(on: On): Logged[] {
  const logged: Logged[] = []
  on('ui.log', (_, e) => {
    logged.push({ text: e.text, to: e.to })
    return { value: undefined }
  })
  return logged
}

function transcript(logged: readonly Logged[]): string[] {
  return logged.filter(line => line.to === 'transcript').map(line => line.text)
}

async function promptOf($: Engine, fake: Fake): Promise<string> {
  await run($, 'continue')
  await fake.clock.settle()
  return fake.prompts[0] ?? ''
}

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1
}

describe('the phase start line', () => {
  test('names the phase that starts after Continue and what it produces', async ($, on) => {
    const logged = recordLog(on)
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'design', slice: '0' }) }), 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B.' })

    const lines = transcript(logged)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('slice')
    expect(lines[0]).toContain('slices.md')
  })

  test('names the intake when /workflow new starts a workflow', async ($, on) => {
    const logged = recordLog(on)
    const fake = fakeEngine(on, { [`${ROOT}/.claude/workflow.json`]: JSON.stringify(CONFIG) })
    fake.isLinked = true
    fake.answers.push(SIZE.feature, COMMITS.no, CHAINING.no, BRANCH.create('feat/add-login'))
    await start($)

    await run($, 'new Add login')

    expect(transcript(logged).some(line => line.includes('intake') && line.includes('goal'))).toBe(true)
  })

  test('is not written when the user answers Not yet', async ($, on) => {
    const logged = recordLog(on)
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'design', slice: '0' }) }), 'feat/login')
    fake.answers.push(GATE.wait)
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', summary: 'Option B.' })

    expect(transcript(logged)).toEqual([])
  })
})

describe('the Leading the user rules', () => {
  const PHASES: Array<[string, Partial<Record<string, string>>]> = [
    ['intake', { phase: 'intake', slice: '0' }],
    ['design', { phase: 'design', slice: '0' }],
    ['slice', { phase: 'slice', slice: '0' }],
    ['build', { phase: 'build' }],
    ['inspect', { phase: 'inspect' }],
    ['spec', { size: 'project', phase: 'spec', slice: '0' }],
    ['retro', { size: 'project', phase: 'retro' }],
  ]

  for (const [name, fields] of PHASES) {
    test(`are in the ${name} phase prompt once: orientation, decisions in a dialog with a recommendation, a Next: line`, async ($, on) => {
      const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText(fields) }), 'feat/login')
      await start($)

      const prompt = await promptOf($, fake)
      const section = prompt.slice(prompt.indexOf(LEADING))

      expect(occurrences(prompt, LEADING)).toBe(1)
      expect(section).toMatch(/step \d of \d/)
      expect(section).toContain('produces')
      expect(section).toContain('AskUserQuestion')
      expect(section).toContain('Recommended')
      expect(section).toContain('Next:')
    })
  }

  test('place the phase among the steps of this workflow', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'design', slice: '0' }) }), 'feat/login')
    await start($)

    const prompt = await promptOf($, fake)

    expect(prompt).toContain('step 2 of 5')
  })

  test('come before the phase instructions', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'design', slice: '0' }) }), 'feat/login')
    await start($)

    const prompt = await promptOf($, fake)

    expect(prompt.indexOf(LEADING)).toBeGreaterThan(-1)
    expect(prompt.indexOf(LEADING)).toBeLessThan(prompt.indexOf('Do the design work.'))
  })
})

describe('the default models in the intake prompt', () => {
  test("list each step of this workflow with its default model and effort, from the mod's plan", async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'intake', slice: '0' }) }), 'feat/login')
    await start($)

    const prompt = await promptOf($, fake)

    for (const line of ['- map: sonnet medium', '- design: opus high', '- slice: opus high', '- build: opus medium', '- review: opus high']) {
      expect(prompt).toContain(line)
    }
    expect(prompt).not.toContain('- spec:')
  })

  test('are left out of the other phase prompts', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'design', slice: '0' }) }), 'feat/login')
    await start($)

    const prompt = await promptOf($, fake)

    expect(prompt).not.toContain('- build: opus medium')
  })
})
