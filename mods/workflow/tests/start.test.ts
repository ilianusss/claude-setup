import { describe, expect, test } from 'claude-code/testing'

import { BRANCH, COMMITS, SIZE } from '../src/labels'
import { parseWorkflow } from '../src/state'
import { CONFIG, DAY, NOW, ROOT, STATE_DIR, fakeEngine, run, start, stateText } from './engine'

const WITH_CONFIG = { [`${ROOT}/.claude/workflow.json`]: JSON.stringify(CONFIG) }

describe('/workflow new', () => {
  test('asks the size, commits and branch, writes the state and starts the first phase', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.answers.push(SIZE.feature, COMMITS.yes, BRANCH.create('feat/add-login'))
    await start($)

    const ran = await run($, 'new Add login')
    await fake.clock.settle()

    const state = parseWorkflow(fake.files.get(`${STATE_DIR}/add-login.md`) ?? '')
    expect(state).toMatchObject({ slug: 'add-login', size: 'feature', phase: 'design', branch: 'feat/add-login', commits: true })
    expect(fake.branch).toBe('feat/add-login')
    expect(fake.tools).toContain('mcp__workflow__lock')
    expect(ran.text).toContain('add-login')
    expect(fake.prompts).toHaveLength(1)
    expect(fake.prompts[0]).toContain('The design phase')
  })

  test('starts with the setup phase when the project has no workflow.json', async ($, on) => {
    const fake = fakeEngine(on)
    fake.answers.push(SIZE.project, COMMITS.no, BRANCH.stay('main'))
    await start($)

    await run($, 'new Billing')

    expect(parseWorkflow(fake.files.get(`${STATE_DIR}/billing.md`) ?? '')).toMatchObject({ phase: 'setup', size: 'project', branch: 'main' })
  })

  test('creates nothing when a dialog is dismissed', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    await start($)

    const ran = await run($, 'new Add login')

    expect(ran.text).toContain('nothing was created')
    expect(fake.files.has(`${STATE_DIR}/add-login.md`)).toBe(false)
  })

  test('refuses a title whose workflow exists', async ($, on) => {
    const fake = fakeEngine(on, { ...WITH_CONFIG, [`${STATE_DIR}/login.md`]: stateText() })
    await start($)

    const ran = await run($, 'new Login')

    expect(ran.text).toContain('/workflow continue login')
    expect(fake.questions).toHaveLength(0)
  })
})

describe('status', () => {
  test('/workflow lists the workflows of this repo', async ($, on) => {
    fakeEngine(on, { ...WITH_CONFIG, [`${STATE_DIR}/login.md`]: stateText({ phase: 'design' }) }, 'feat/login')
    await start($)

    const ran = await run($, '')

    expect(ran.text).toContain('login: design')
    expect(ran.text).toContain('current branch')
  })

  test('/workflow says how to start when there is none', async ($, on) => {
    fakeEngine(on, WITH_CONFIG)
    await start($)

    const ran = await run($, '')

    expect(ran.text).toContain('/workflow new')
  })

  test('a session start shows open workflows and puts the current one in the status line', async ($, on) => {
    const fake = fakeEngine(
      on,
      {
        ...WITH_CONFIG,
        [`${STATE_DIR}/login.md`]: stateText({ phase: 'design', updated: new Date(NOW - 3 * DAY).toISOString() }),
      },
      'feat/login',
    )
    await start($)

    expect(fake.toasts.join('\n')).toContain('login (design, 3 days ago)')
    expect(fake.statuses.at(-1)).toBe('workflow login: design')
    expect(fake.tools).toContain('mcp__workflow__handoff')
  })

  test('a session start in a repo without workflows stays quiet', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    await start($)

    expect(fake.toasts).toHaveLength(0)
    expect(fake.tools).toHaveLength(0)
  })

  test('/workflow all lists open workflows from every repo', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.answers.push(SIZE.feature, COMMITS.no, BRANCH.stay('main'))
    await start($)
    await run($, 'new Add login')

    const ran = await run($, 'all')

    expect(ran.text).toContain(`${ROOT}: add-login (design)`)
  })
})
