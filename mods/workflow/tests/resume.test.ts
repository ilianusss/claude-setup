import { describe, expect, test } from 'claude-code/testing'

import { ADOPT, RETRO, SWITCH } from '../src/labels'
import { parseWorkflow } from '../src/state'
import { DAY, NOW, ROOT, SLICES, STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'

function state(files: Map<string, string>, slug = 'login') {
  return parseWorkflow(files.get(`${STATE_DIR}/${slug}.md`) ?? '')
}

describe('/workflow continue', () => {
  test('picks the workflow of the current branch and starts its step', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')
    await start($)

    const ran = await run($, 'continue')
    await fake.clock.settle()

    expect(ran.text).toContain('login')
    expect(fake.prompts[0]).toContain('The build phase')
    expect(fake.prompts[0]).toContain('Slice 1: Walking skeleton')
    expect(fake.prompts[0]).toContain('Form and route.')
    expect(fake.prompts[0]).toContain('Write slice 1 tests.')
  })

  test('offers to switch to the workflow branch', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'main')
    fake.answers.push(SWITCH.yes('feat/login'))
    await start($)

    await run($, 'continue login')
    await fake.clock.settle()

    expect(fake.branch).toBe('feat/login')
    expect(fake.prompts).toHaveLength(1)
  })

  test('after a long break the prompt carries the drift facts', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ updated: new Date(NOW - 30 * DAY).toISOString() }) }), 'feat/login')
    fake.behind = 3
    fake.gitLog = 'abc123 feat(src): rename the session store\n'
    await start($)

    await run($, 'continue')
    await fake.clock.settle()

    expect(fake.prompts[0]).toContain('30 days')
    expect(fake.prompts[0]).toContain('3 commits behind origin/main')
    expect(fake.prompts[0]).toContain('rename the session store')
    expect(fake.prompts[0]).toContain('drift-check.md')
  })

  test('says when there is no workflow to continue', async ($, on) => {
    const fake = fakeEngine(on, { [`${ROOT}/README.md`]: '# x' })
    await start($)

    const ran = await run($, 'continue')

    expect(ran.text).toContain('/workflow new')
    expect(fake.prompts).toHaveLength(0)
  })
})

describe('/workflow next', () => {
  test('clears the context, then continues', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')
    await start($)

    await run($, 'next')
    await fake.clock.settle()

    expect(fake.commands).toContain('clear')
    expect(fake.prompts[0]).toContain('The build phase')
  })
})

describe('closing and pausing', () => {
  test('/workflow pause pauses and asks for the handoff', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')
    await start($)

    await run($, 'pause')
    await fake.clock.settle()

    expect(state(fake.files).status).toBe('paused')
    expect(fake.prompts[0]).toContain('mcp__workflow__handoff')
  })

  test('/workflow done on a project offers the retro first', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ size: 'project', phase: 'inspect' }) }), 'feat/login')
    fake.answers.push(RETRO.run)
    await start($)

    await run($, 'done login')
    await fake.clock.settle()

    expect(state(fake.files).phase).toBe('retro')
    expect(fake.prompts[0]).toContain('The retro phase')
  })

  test('/workflow done closes a feature', async ($, on) => {
    const fake = fakeEngine(on, buildRepo({ [`${STATE_DIR}/login.md`]: stateText({ phase: 'inspect' }) }), 'feat/login')
    await start($)

    await run($, 'done login')

    expect(state(fake.files)).toMatchObject({ status: 'done', phase: 'done' })
  })

  test('/workflow abandon closes it with the reason', async ($, on) => {
    const fake = fakeEngine(on, buildRepo(), 'feat/login')
    await start($)

    await run($, 'abandon login the feature was dropped')

    expect(state(fake.files).status).toBe('abandoned')
    expect(state(fake.files).log.join('\n')).toContain('abandoned: the feature was dropped')
  })
})

describe('/workflow adopt', () => {
  test('rebuilds a workflow from the specs a fresh clone kept', async ($, on) => {
    const slices = SLICES.replace('- [ ] Done', '- [x] Done')
    const fake = fakeEngine(
      on,
      {
        ...buildRepo(),
        [`${STATE_DIR}/login.md`]: '',
        [`${ROOT}/docs/specs/login/slices.md`]: slices,
      },
      'feat/login',
    )
    fake.files.delete(`${STATE_DIR}/login.md`)
    fake.answers.push(ADOPT.rebuild)
    await start($)

    const ran = await run($, 'adopt')

    expect(state(fake.files)).toMatchObject({ phase: 'build', slice: 2, size: 'feature', branch: 'feat/login' })
    expect(ran.text).toContain('login')
  })

  test('runs the setup phase when the project has no workflow.json', async ($, on) => {
    const fake = fakeEngine(on, { [`${ROOT}/README.md`]: '# x' })
    await start($)

    await run($, 'adopt')
    await fake.clock.settle()

    expect(fake.prompts[0]).toContain('The setup phase')
  })
})
