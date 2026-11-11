import { describe, expect, test } from 'claude-code/testing'

import { BRANCH, CHAINING, COMMITS, SIZE } from '../src/labels'
import { parseWorkflow } from '../src/state'
import { CONFIG, DAY, NOW, ROOT, STATE_DIR, fakeEngine, run, start, stateText } from './engine'

const WITH_CONFIG = { [`${ROOT}/.claude/workflow.json`]: JSON.stringify(CONFIG) }

describe('/workflow new', () => {
  test('in a free linked worktree, asks the size, commits and branch, writes the state and starts the first phase', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.isLinked = true
    fake.answers.push(SIZE.feature, COMMITS.yes, CHAINING.no, BRANCH.create('feat/add-login'))
    await start($)

    const ran = await run($, 'new Add login')
    await fake.clock.settle()

    const state = parseWorkflow(fake.files.get(`${STATE_DIR}/add-login.md`) ?? '')
    expect(state).toMatchObject({ slug: 'add-login', size: 'feature', phase: 'intake', branch: 'feat/add-login', commits: true })
    expect(fake.branch).toBe('feat/add-login')
    expect(fake.tools).toContain('mcp__workflow__lock')
    expect(ran.text).toContain('add-login')
    expect(fake.prompts).toHaveLength(1)
    expect(fake.prompts[0]).toContain('The intake phase')
  })

  test('starts with the intake even when the project has no workflow.json', async ($, on) => {
    const fake = fakeEngine(on)
    fake.isLinked = true
    fake.answers.push(SIZE.project, COMMITS.no, CHAINING.no, BRANCH.stay('main'))
    await start($)

    await run($, 'new Billing')

    expect(parseWorkflow(fake.files.get(`${STATE_DIR}/billing.md`) ?? '')).toMatchObject({ phase: 'intake', size: 'project', branch: 'main' })
  })

  test('in the main checkout, creates a worktree next to the repo without asking for a branch', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.answers.push(SIZE.feature, COMMITS.yes, CHAINING.no)
    await start($)

    const ran = await run($, 'new Add login')
    await fake.clock.settle()

    const state = parseWorkflow(fake.files.get(`${STATE_DIR}/add-login.md`) ?? '')
    expect(state).toMatchObject({ branch: 'feat/add-login', worktree: `${ROOT}-add-login` })
    expect(fake.questions).toHaveLength(3)
    expect(fake.branch).toBe('main')
    expect(fake.prompts).toHaveLength(1)
    expect(ran.text).toContain(`new worktree ${ROOT}-add-login`)
  })

  test('in a linked worktree that runs a workflow, creates another worktree without asking for a branch', async ($, on) => {
    const fake = fakeEngine(on, { ...WITH_CONFIG, [`${STATE_DIR}/login.md`]: stateText() }, 'feat/login')
    fake.isLinked = true
    fake.answers.push(SIZE.feature, COMMITS.no, CHAINING.no)
    await start($)

    const ran = await run($, 'new Billing')

    expect(parseWorkflow(fake.files.get(`${STATE_DIR}/billing.md`) ?? '')).toMatchObject({ branch: 'feat/billing', worktree: `${ROOT}-billing` })
    expect(fake.questions).toHaveLength(3)
    expect(ran.text).toContain(`new worktree ${ROOT}-billing`)
  })

  test('creates nothing when a dialog is dismissed', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    await start($)

    const ran = await run($, 'new Add login')

    expect(ran.text).toContain('nothing was created')
    expect(fake.files.has(`${STATE_DIR}/add-login.md`)).toBe(false)
  })

  test('asks the size, then the commits, then whether to start the next slice without asking', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.answers.push(SIZE.feature, COMMITS.yes, CHAINING.yes)
    await start($)

    await run($, 'new Add login')

    expect(fake.questions).toEqual([SIZE.question('Add login'), COMMITS.question, CHAINING.question])
  })

  test('saves a yes to the chaining question as auto_next', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.answers.push(SIZE.feature, COMMITS.yes, CHAINING.yes)
    await start($)

    await run($, 'new Add login')

    expect(parseWorkflow(fake.files.get(`${STATE_DIR}/add-login.md`) ?? '').autoNext).toBe(true)
  })

  test('saves a no to the chaining question as no auto_next', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.answers.push(SIZE.feature, COMMITS.yes, CHAINING.no)
    await start($)

    await run($, 'new Add login')

    expect(parseWorkflow(fake.files.get(`${STATE_DIR}/add-login.md`) ?? '').autoNext).toBe(false)
  })

  test('in the main checkout, submits a prompt to enter the new worktree, then start the intake', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.answers.push(SIZE.feature, COMMITS.yes, CHAINING.no)
    await start($)

    await run($, 'new Add login')
    await fake.clock.settle()

    const prompt = fake.prompts[0] ?? ''
    expect(prompt).toContain('EnterWorktree')
    expect(prompt).toContain(`\`path\` set to \`${ROOT}-add-login\``)
    expect(prompt).toContain('The intake phase')
    expect(prompt.indexOf('EnterWorktree')).toBeLessThan(prompt.indexOf('The intake phase'))
  })

  test('the worktree prompt tells Claude to send the user to /workflow continue when it cannot enter', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.answers.push(SIZE.feature, COMMITS.yes, CHAINING.no)
    await start($)

    await run($, 'new Add login')
    await fake.clock.settle()

    expect(fake.prompts[0]).toContain('/workflow continue add-login')
  })

  test('in the main checkout, answers that Claude moves the session into the new worktree', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.answers.push(SIZE.feature, COMMITS.yes, CHAINING.no)
    await start($)

    const ran = await run($, 'new Add login')

    expect(ran.text).toContain(`${ROOT}-add-login`)
    expect(ran.text).toContain('moving the session there')
    expect(ran.text).not.toContain('Start a session there')
  })

  test('in a free linked worktree, starts the intake there without entering another worktree', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.isLinked = true
    fake.answers.push(SIZE.feature, COMMITS.yes, CHAINING.no, BRANCH.stay('main'))
    await start($)

    await run($, 'new Add login')
    await fake.clock.settle()

    expect(fake.prompts).toHaveLength(1)
    expect(fake.prompts[0]).toContain('The intake phase')
    expect(fake.prompts[0]).not.toContain('EnterWorktree')
  })

  test('without a title, fills the prompt box with /workflow new and asks for a name in one line', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    await start($)

    const ran = await run($, 'new')

    expect(fake.fills).toEqual(['/workflow new '])
    expect(ran.text).toContain('name')
    expect(ran.text).not.toContain('\n')
    expect(fake.questions).toHaveLength(0)
  })

  test('creates nothing when the chaining dialog is dismissed', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.answers.push(SIZE.feature, COMMITS.yes)
    await start($)

    const ran = await run($, 'new Add login')
    await fake.clock.settle()

    expect(ran.text).toContain('nothing was created')
    expect(fake.files.has(`${STATE_DIR}/add-login.md`)).toBe(false)
    expect(fake.prompts).toHaveLength(0)
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
    expect(fake.statuses.at(-1)).toBe('workflow login: design, opus high, waiting for you')
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
    fake.answers.push(SIZE.feature, COMMITS.no, CHAINING.no, BRANCH.stay('main'))
    await start($)
    await run($, 'new Add login')

    const ran = await run($, 'all')

    expect(ran.text).toContain(`${ROOT}: add-login (intake)`)
  })

  test('/workflow all drops the workflows of a repo that no longer exists', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.answers.push(SIZE.feature, COMMITS.no, CHAINING.no, BRANCH.stay('main'))
    await start($)
    await run($, 'new Add login')
    for (const path of [...fake.files.keys()]) if (path.startsWith(`${ROOT}/`)) fake.files.delete(path)

    const ran = await run($, 'all')

    expect(ran.text).toBe('no open workflow anywhere.')
  })
})

describe('command replies', () => {
  test('leave the "workflow:" prefix to Claude Code, which adds it to every reply', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    await start($)

    const replies = [await run($, ''), await run($, 'all'), await run($, 'new'), await run($, 'continue'), await run($, 'unlock')]
    await fake.clock.settle()

    for (const ran of replies) expect(ran.text).not.toMatch(/^workflow:/)
  })
})
