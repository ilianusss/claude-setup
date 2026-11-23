import { describe, expect, test } from 'claude-code/testing'

import { PUBLISH } from '../src/labels'
import { STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'

const CLOSING = '## Closing the workflow'

async function promptOf($: Parameters<typeof start>[0], on: Parameters<typeof fakeEngine>[0], fields: Record<string, string>): Promise<string> {
  const fake = fakeEngine(on, buildRepo({ [`${STATE_DIR}/login.md`]: stateText(fields) }), 'feat/login')
  await start($)
  await run($, 'continue')
  await fake.clock.settle()
  return fake.prompts[0] ?? ''
}

function closingOf(prompt: string): string {
  const at = prompt.indexOf(CLOSING)
  return at < 0 ? '' : prompt.slice(at)
}

describe('the closing section', () => {
  test("is in a feature's inspect prompt", async ($, on) => {
    expect(await promptOf($, on, { phase: 'inspect' })).toContain(CLOSING)
  })

  test("is not in a project's inspect prompt, whose retro comes after", async ($, on) => {
    expect(await promptOf($, on, { phase: 'inspect', size: 'project' })).not.toContain(CLOSING)
  })

  test("is in a project's retro prompt", async ($, on) => {
    expect(await promptOf($, on, { phase: 'retro', size: 'project' })).toContain(CLOSING)
  })

  test('is in no earlier phase', async ($, on) => {
    expect(await promptOf($, on, { phase: 'design' })).not.toContain(CLOSING)
  })

  test('drafts the pull request, removes the documents, asks what to publish, then approves, in that order', async ($, on) => {
    const closing = closingOf(await promptOf($, on, { phase: 'inspect', keep_docs: 'specs' }))

    const order = ['Draft the pull request', 'Remove', PUBLISH.all, 'mcp__workflow__advance'].map(part => closing.indexOf(part))
    expect(order.every(at => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  test('offers each way to publish, and says the commit, push and pull request parts drop out once done', async ($, on) => {
    const closing = closingOf(await promptOf($, on, { phase: 'inspect' }))

    for (const option of [PUBLISH.all, PUBLISH.push, PUBLISH.commit, PUBLISH.nothing]) expect(closing).toContain(option)
    expect(closing).toContain('gh pr view')
    expect(closing).toContain('git push -u origin feat/login')
  })

  test('takes the known issues from design.md, read before any document is removed', async ($, on) => {
    expect(closingOf(await promptOf($, on, { phase: 'inspect', keep_docs: 'code' }))).toContain('## Known issues')
  })

  test('keeping everything removes no document', async ($, on) => {
    const closing = closingOf(await promptOf($, on, { phase: 'inspect' }))

    expect(closing).toContain('Remove no document')
    expect(closing).not.toContain('git rm')
  })

  test('removing the spec and ADRs names the spec folder and the ADRs this branch added, and nothing else', async ($, on) => {
    const closing = closingOf(await promptOf($, on, { phase: 'inspect', keep_docs: 'specs' }))

    expect(closing).toContain('`docs/specs/login/`')
    expect(closing).toContain('`docs/adr/`')
    expect(closing).toContain('--diff-filter=A')
    expect(closing).not.toContain('.claude/workflow.json')
  })

  test('keeping only the code removes the setup files this branch added, and never reverts an edited file', async ($, on) => {
    const closing = closingOf(await promptOf($, on, { phase: 'inspect', keep_docs: 'code' }))

    expect(closing).toContain('`docs/specs/login/`')
    expect(closing).toContain('`.claude/workflow.json`')
    expect(closing).toContain('--diff-filter=A')
    expect(closing).toContain('never revert')
  })

  test('choosing at the end asks which added files to keep in one multi-select question', async ($, on) => {
    const closing = closingOf(await promptOf($, on, { phase: 'inspect', keep_docs: 'ask' }))

    expect(closing).toContain('multiSelect')
    expect(closing).toContain('--diff-filter=A')
  })
})
