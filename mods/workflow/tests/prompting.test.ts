import type { AgentSpec } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ADOPT, BRANCH, CHAINING, COMMITS, DELETE, DOCS, GATE, MODELS, PROMPTING, SIZE, TECHNICAL } from '../src/labels'
import { DEFAULT_PLAN } from '../src/plan'
import { parseWorkflow, renderWorkflow } from '../src/state'
import type { Phase } from '../src/state'
import { CONFIG, CONTINUE, INTAKE_POINTS, ROOT, STATE_DIR, buildRepo, fakeEngine, run, start, stateText } from './engine'
import type { Fake } from './engine'

const STATE_FILE = `${STATE_DIR}/login.md`
const WITH_CONFIG = { [`${ROOT}/.claude/workflow.json`]: JSON.stringify(CONFIG) }
const RECOMMENDATIONS = [{ step: 'build', model: 'sonnet', effort: 'high', reason: 'The slices are small and well specified.' }]
const PHASE_SECTION = '## What to ask the user'
const AGENT_SECTION = '## What the user is asked'
const GUIDE = 'guides/decision-guide.md'

function state(fake: Fake) {
  return parseWorkflow(fake.files.get(STATE_FILE) ?? '')
}

function text(ran: { deny?: string; result?: unknown }): string {
  return ran.deny ?? String(ran.result)
}

function sectionOf(prompt: string, heading: string): string {
  const begin = prompt.indexOf(heading)
  if (begin < 0) return ''
  const end = prompt.indexOf('\n## ', begin + heading.length)
  return prompt.slice(begin, end < 0 ? undefined : end)
}

async function phasePromptOf($: Engine, fake: Fake): Promise<string> {
  await start($)
  await run($, 'continue')
  await fake.clock.settle()
  return fake.prompts[0] ?? ''
}

function agentPrompt(fake: Fake, name: string): string {
  return fake.agents.filter((spec: AgentSpec) => spec.name === name).at(-1)?.prompt ?? ''
}

function inPhase(phase: string, fields: Partial<Record<string, string>> = {}): Record<string, string> {
  return buildRepo({ [STATE_FILE]: stateText({ phase, slice: '0', ...fields }) })
}

function withoutConfig(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => path !== `${ROOT}/.claude/workflow.json`))
}

describe('the prompting settings in the state', () => {
  test('a workflow saved before the settings existed reads as asked about every decision, technical ones included', () => {
    const workflow = parseWorkflow(stateText())

    expect(workflow).toMatchObject({ prompting: 'all', technical: true })
  })

  test('the settings round-trip through the state file', () => {
    const saved = parseWorkflow(stateText({ prompting: 'major', technical: 'no' }))

    expect(parseWorkflow(renderWorkflow(saved))).toMatchObject({ prompting: 'major', technical: false })
    expect(renderWorkflow(saved)).toContain('\nprompting: major\ntechnical: no\n')
  })

  test('a prompting level other than all or major is refused', () => {
    expect(() => parseWorkflow(stateText({ prompting: 'some' }))).toThrow('prompting is "some", expected one of all, major')
  })

  test('/workflow adopt rebuilds a workflow that asks about every decision', async ($, on) => {
    const fake = fakeEngine(on, { ...WITH_CONFIG, [`${ROOT}/docs/specs/billing/design.md`]: '# Design\n' })
    fake.answers.push(ADOPT.rebuild)
    await start($)

    await run($, 'adopt')

    expect(parseWorkflow(fake.files.get(`${STATE_DIR}/billing.md`) ?? '')).toMatchObject({ prompting: 'all', technical: true })
  })
})

describe('/workflow new asks the prompting settings', () => {
  test('saves the prompting level and the technical decisions it was given', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.answers.push(SIZE.feature, PROMPTING.major, TECHNICAL.yes, COMMITS.yes, DOCS.all, CHAINING.no)
    await start($)

    await run($, 'new Add login')

    expect(parseWorkflow(fake.files.get(`${STATE_DIR}/add-login.md`) ?? '')).toMatchObject({ prompting: 'major', technical: true, autoNext: false })
  })

  test('with technical decisions off, does not ask about the next slice and chains the slices', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.answers.push(SIZE.feature, PROMPTING.all, TECHNICAL.no, COMMITS.no, DOCS.all)
    await start($)

    await run($, 'new Add login')

    expect(fake.questions).toEqual([SIZE.question('Add login'), PROMPTING.question, TECHNICAL.question, COMMITS.question, DOCS.question])
    expect(parseWorkflow(fake.files.get(`${STATE_DIR}/add-login.md`) ?? '')).toMatchObject({ prompting: 'all', technical: false, autoNext: true })
  })

  test('with technical decisions off, still asks for the branch in a free linked worktree', async ($, on) => {
    const fake = fakeEngine(on, WITH_CONFIG)
    fake.isLinked = true
    fake.answers.push(SIZE.feature, PROMPTING.major, TECHNICAL.no, COMMITS.no, DOCS.all, BRANCH.create('feat/add-login'))
    await start($)

    await run($, 'new Add login')

    expect(fake.questions.at(-1)).toBe('Which branch should "add-login" use?')
    expect(fake.branch).toBe('feat/add-login')
  })
})

describe('the gates with technical decisions off', () => {
  const technicalGates: Array<[Phase, Record<string, string>]> = [
    ['setup', withoutConfig(inPhase('setup', { technical: 'no' }))],
    ['design', inPhase('design', { technical: 'no' })],
    ['slice', inPhase('slice', { technical: 'no' })],
  ]
  for (const [phase, files] of technicalGates) {
    test(`the ${phase} gate moves on without a dialog, logged, as if the user chose Continue`, async ($, on) => {
      const fake = fakeEngine(on, files, 'feat/login')
      await start($)

      const ran = text(await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Done.'] }))
      await fake.clock.settle()

      expect(fake.questions).toEqual([])
      expect(state(fake).phase).not.toBe(phase)
      expect(state(fake).status).toBe('active')
      expect(state(fake).log.at(-1)).toContain(`${phase} approved without asking (technical decisions are off)`)
      expect(ran).toContain(GATE.notAsked(phase))
      expect(fake.fills).toEqual([CONTINUE])
      expect(fake.prompts).toHaveLength(0)
    })
  }

  test("a feature's inspect gate closes it without the gate's dialog", async ($, on) => {
    const fake = fakeEngine(on, inPhase('inspect', { technical: 'no', worktree: ROOT }), 'feat/login')
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Pull request opened.'] })

    expect(fake.questions).toEqual([])
    expect(state(fake)).toMatchObject({ phase: 'done', status: 'done' })
  })

  test('the spec gate still asks', async ($, on) => {
    const fake = fakeEngine(on, inPhase('spec', { size: 'project', technical: 'no' }), 'feat/login')
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['The spec.'] })

    expect(fake.questions).toHaveLength(1)
    expect(state(fake).phase).toBe('spec')
  })

  test('the retro gate still asks', async ($, on) => {
    const fake = fakeEngine(on, inPhase('retro', { size: 'project', technical: 'no', worktree: ROOT }), 'feat/login')
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Two changes.'] })

    expect(fake.questions).toHaveLength(1)
    expect(state(fake).phase).toBe('retro')
  })

  test('with technical decisions on, the design gate asks', async ($, on) => {
    const fake = fakeEngine(on, inPhase('design', { prompting: 'major' }), 'feat/login')
    await start($)

    await $.tool.call({ tool: 'mcp__workflow__advance', produced: ['Option B.'] })

    expect(fake.questions).toHaveLength(1)
    expect(state(fake).phase).toBe('design')
  })
})

describe("the intake's gate with technical decisions off", () => {
  test('asks the gate, then uses Claude\'s recommendations without the model question and says so', async ($, on) => {
    const fake = fakeEngine(on, inPhase('intake', { technical: 'no' }), 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    const ran = text(await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS, recommendations: RECOMMENDATIONS }))

    expect(fake.questions).toHaveLength(1)
    expect(state(fake).models).toEqual({ ...DEFAULT_PLAN, build: { model: 'sonnet', effort: 'high' } })
    expect(ran).toContain(MODELS.notAsked(MODELS.usedRecommended('build on sonnet high (default opus medium)')))
  })

  test('uses the defaults when Claude gave no recommendation, and says so', async ($, on) => {
    const fake = fakeEngine(on, inPhase('intake', { technical: 'no', models: '[build sonnet low]' }), 'feat/login')
    fake.answers.push(GATE.continue)
    await start($)

    const ran = text(await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS }))

    expect(fake.questions).toHaveLength(1)
    expect(state(fake).models).toEqual(DEFAULT_PLAN)
    expect(ran).toContain(MODELS.notAsked(MODELS.usedDefaults))
  })

  test('on Stop here, still sets the models without asking', async ($, on) => {
    const fake = fakeEngine(on, inPhase('intake', { technical: 'no' }), 'feat/login')
    fake.answers.push(GATE.stop)
    await start($)

    const ran = text(await $.tool.call({ tool: 'mcp__workflow__advance', ...INTAKE_POINTS, recommendations: RECOMMENDATIONS }))

    expect(fake.questions).toHaveLength(1)
    expect(state(fake)).toMatchObject({ status: 'paused', models: { ...DEFAULT_PLAN, build: { model: 'sonnet', effort: 'high' } } })
    expect(ran).toContain(MODELS.notAsked(MODELS.usedRecommended('build on sonnet high (default opus medium)')))
  })
})

describe('what stays asked with technical decisions off', () => {
  test('/workflow delete still asks its confirmation', async ($, on) => {
    const fake = fakeEngine(on, inPhase('inspect', { size: 'project', technical: 'no' }), 'feat/login')
    await start($)

    await run($, 'delete login')

    expect(fake.questions).toEqual([DELETE.question('login', 'active')])
  })
})

describe('the phase prompt states the prompting settings', () => {
  test('every decision, technical ones included: says so, with no rule about decisions not asked', async ($, on) => {
    const fake = fakeEngine(on, inPhase('design'), 'feat/login')

    const section = sectionOf(await phasePromptOf($, fake), PHASE_SECTION)

    expect(section).toContain('asks the user about every decision, product and technical')
    expect(section).not.toContain('not asked')
  })

  test('major decisions only: points to the guide and takes the recommended option for the rest', async ($, on) => {
    const fake = fakeEngine(on, inPhase('design', { prompting: 'major' }), 'feat/login')

    const section = sectionOf(await phasePromptOf($, fake), PHASE_SECTION)

    expect(section).toContain('asks the user about the major decisions only, product and technical')
    expect(section).toContain(GUIDE)
    expect(section).toContain('take your recommended option')
    expect(section).toContain("the spec's Decisions taken, the design's Decision and its ADRs")
    expect(section).not.toContain('without a dialog')
  })

  test('no technical decisions: asks product and design only, and says the technical gates move on by themselves', async ($, on) => {
    const fake = fakeEngine(on, inPhase('design', { technical: 'no' }), 'feat/login')

    const section = sectionOf(await phasePromptOf($, fake), PHASE_SECTION)

    expect(section).toContain('asks the user about every product and design decision, and about no technical one')
    expect(section).toContain(GUIDE)
    expect(section).toContain('take your recommended option')
    expect(section).toContain('without a dialog')
    expect(section).toContain('still call mcp__workflow__advance')
    expect(section).toContain('the unlock of a locked test')
  })

  test('major product and design decisions only: says so, with the technical gates rule', async ($, on) => {
    const fake = fakeEngine(on, inPhase('design', { prompting: 'major', technical: 'no' }), 'feat/login')

    const section = sectionOf(await phasePromptOf($, fake), PHASE_SECTION)

    expect(section).toContain('asks the user about the major product and design decisions only, and about no technical one')
    expect(section).toContain(GUIDE)
    expect(section).toContain('without a dialog')
  })

  test('with technical decisions off, the design opens with the map without asking', async ($, on) => {
    const fake = fakeEngine(on, inPhase('design', { technical: 'no' }), 'feat/login')

    const section = sectionOf(await phasePromptOf($, fake), '## The map agent')

    expect(section).toContain('workflow:map')
    expect(section).toContain('without asking')
    expect(section).not.toContain('AskUserQuestion')
  })

  test('with technical decisions off, inspect fixes the recommended minor findings without asking', async ($, on) => {
    const fake = fakeEngine(on, inPhase('inspect', { technical: 'no' }), 'feat/login')

    const section = sectionOf(await phasePromptOf($, fake), '## Review rounds')

    expect(section).toContain('do not ask which minor findings to fix')
    expect(section).toContain('the ones you recommend')
  })

  test('with technical decisions on, inspect has no rule about the minor findings', async ($, on) => {
    const fake = fakeEngine(on, inPhase('inspect', { prompting: 'major' }), 'feat/login')

    expect(sectionOf(await phasePromptOf($, fake), '## Review rounds')).not.toContain('minor findings')
  })

  test('with technical decisions off, the intake says the models are not asked', async ($, on) => {
    const fake = fakeEngine(on, inPhase('intake', { technical: 'no' }), 'feat/login')

    const section = sectionOf(await phasePromptOf($, fake), '## Default models')

    expect(section).toContain('the user is not asked to choose the models')
  })

  test('with technical decisions on, the intake leaves the model choice to the user', async ($, on) => {
    const fake = fakeEngine(on, inPhase('intake'), 'feat/login')

    expect(sectionOf(await phasePromptOf($, fake), '## Default models')).not.toContain('not asked')
  })
})

describe('the step agents state the prompting settings', () => {
  test('every decision, technical ones included: each one goes in the open questions', async ($, on) => {
    const fake = fakeEngine(on, inPhase('design'), 'feat/login')
    await start($)

    const section = sectionOf(agentPrompt(fake, 'design'), AGENT_SECTION)

    expect(section).toContain('asks the user about every decision, product and technical')
    expect(section).not.toContain('recommended option')
  })

  test('major decisions only: only those go in the open questions, the rest takes the recommended option', async ($, on) => {
    const fake = fakeEngine(on, inPhase('design', { prompting: 'major' }), 'feat/login')
    await start($)

    const section = sectionOf(agentPrompt(fake, 'design'), AGENT_SECTION)

    expect(section).toContain('asks the user about the major decisions only, product and technical')
    expect(section).toContain(GUIDE)
    expect(section).toContain('Put in your open questions only the decisions the user is asked about')
    expect(section).toContain('take your recommended option')
  })

  test('no technical decisions: product and design only, a wrong test still goes to the user', async ($, on) => {
    const fake = fakeEngine(on, inPhase('build', { slice: '1', technical: 'no' }), 'feat/login')
    await start($)

    const section = sectionOf(agentPrompt(fake, 'build'), AGENT_SECTION)

    expect(section).toContain('asks the user about every product and design decision, and about no technical one')
    expect(section).toContain(GUIDE)
    expect(section).toContain('take your recommended option')
    expect(section).toContain('A test that looks wrong still goes in your open questions')
  })

  test('major product and design decisions only: says so in every step agent', async ($, on) => {
    const fake = fakeEngine(on, inPhase('slice', { prompting: 'major', technical: 'no' }), 'feat/login')
    await start($)

    for (const name of ['map', 'design', 'slice', 'build', 'review']) {
      expect(sectionOf(agentPrompt(fake, name), AGENT_SECTION)).toContain(
        'asks the user about the major product and design decisions only, and about no technical one',
      )
    }
  })
})
