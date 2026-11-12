import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'
import type { Fake } from './engine'

const STATE_FILE = `${STATE_DIR}/login.md`
const MAP_SECTION = '## The map agent'

async function designPrompt($: Engine, fake: Fake): Promise<string> {
  await start($)
  await run($, 'continue')
  await fake.clock.settle()
  return fake.prompts[0] ?? ''
}

function mapSection(prompt: string): string {
  const start = prompt.indexOf(MAP_SECTION)
  if (start < 0) return ''
  const end = prompt.indexOf('\n## ', start + MAP_SECTION.length)
  return prompt.slice(start, end < 0 ? undefined : end)
}

describe('the project map in the design phase', () => {
  test('a feature is offered the map first, in a dialog with Yes recommended', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'design', slice: '0' }) }), 'feat/login')

    const section = mapSection(await designPrompt($, fake))

    expect(section).toContain('AskUserQuestion')
    expect(section).toMatch(/Yes[^\n]*\(Recommended\)/)
    expect(section).toContain('workflow:map')
  })

  test("on yes, workflow:map adds a Context section to design.md, on the map's plan model", async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'design', slice: '0', models: '[map haiku low]' }) }), 'feat/login')

    const section = mapSection(await designPrompt($, fake))

    expect(section).toContain('## Context')
    expect(section).toContain('design.md')
    expect(section).toContain('haiku low')
  })

  test('a project, which has its spec, is not offered the map', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ size: 'project', phase: 'design', slice: '0' }) }), 'feat/login')

    const prompt = await designPrompt($, fake)

    expect(prompt).not.toContain(MAP_SECTION)
    expect(prompt).not.toContain('workflow:map')
  })

  test('a feature is not offered the map outside the design phase', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [STATE_FILE]: stateText({ phase: 'slice', slice: '0' }) }), 'feat/login')

    expect(await designPrompt($, fake)).not.toContain(MAP_SECTION)
  })
})
