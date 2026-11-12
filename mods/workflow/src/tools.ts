import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RegisteredToolSpec } from 'claude-code'

import { registerAgents } from './agents'
import { askOrUndefined } from './ask'
import { lockSlice, nextStep, unlockFile, verifiedForAgent, verifiedForConversation, verifySlice } from './build'
import { day, iso, submitLater } from './clock'
import { loadContext, readSlices } from './context'
import type { Context } from './context'
import { GATE, MODELS } from './labels'
import { readPhase, stepsOf } from './phases'
import { chooseModels, rememberRecommendations, savePlan } from './picker'
import { DEFAULT_PLAN, EFFORTS, MODELS as MODEL_NAMES, STEPS, parseRecommendations, withRecommendations } from './plan'
import type { ModelPlan, Recommendation } from './plan'
import { NEXT_IN_ITS_OWN_TURN, phasePrompt, stopPrompt } from './prompts'
import { Refusal, describe, refuse } from './refusal'
import { finish, offerEnding, rememberEnteredWorktree } from './ending'
import { endReviewRound } from './review'
import type { Runtime } from './runtime'
import { inPhase, phaseAfter, withLog } from './state'
import type { Workflow } from './state'
import { announcePhase, clearVerified, markVerified, refreshStatus, turnEnded } from './status'
import { saveWorkflow } from './store'

// Kept in $.state, which a reload of the mod keeps, so a build agent that verified a slice before a reload still hands
// over when its run ends after it.
const handovers = atom({ plugin: 'workflow', key: 'handovers' } as const, {}, { shape: 'handovers-1' })

const TOOLS: readonly RegisteredToolSpec[] = [
  {
    name: 'handoff',
    description:
      'Save where the current workflow stopped, the next concrete action and the open questions into its state. Call it before a session ends, after a slice closes, or when the user pauses.',
    inputSchema: {
      type: 'object',
      properties: {
        stopped: { type: 'string', description: 'Where things stand, in one or two sentences.' },
        next: { type: 'string', description: 'The next concrete action.' },
        questions: { type: 'array', items: { type: 'string' }, description: 'Questions still open for the user.' },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'The folders this workflow touches, relative to the repo root. Set it in the design phase; the drift check watches them.',
        },
        goal: {
          type: 'string',
          description: 'The goal the user confirmed in the intake, as restated to them. Accepted in the intake phase only.',
        },
      },
      required: ['stopped', 'next'],
    },
    isDeferred: false,
  },
  {
    name: 'advance',
    description:
      "Ask the user to approve the current phase and move the workflow to its next phase. The user answers in Claude Code's own dialog. Give a short summary of what the phase produced.",
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'What the phase produced, for the user to approve.' },
        recommendations: {
          type: 'array',
          description:
            "The intake's gate only: the model and effort you recommend for the steps of this workflow where they differ from the defaults, each with its reason. The user decides whether to use them; refused in any other phase.",
          items: {
            type: 'object',
            properties: {
              step: { type: 'string', enum: [...STEPS] },
              model: { type: 'string', enum: [...MODEL_NAMES] },
              effort: { type: 'string', enum: [...EFFORTS] },
              reason: { type: 'string', description: 'Why, in one line. Required for xhigh.' },
            },
            required: ['step', 'model', 'effort'],
          },
        },
      },
      required: ['summary'],
    },
    isDeferred: false,
  },
  {
    name: 'lock',
    description:
      "Lock the current slice's tests once they fail for the right reason. Answers with the exact command to run when the mod has not seen it fail on the current code.",
    inputSchema: { type: 'object', properties: {} },
    isDeferred: false,
  },
  {
    name: 'verify',
    description:
      "Close the current slice once its tests, lint, typecheck and the full suite passed on the current code. Answers with the checks still missing.",
    inputSchema: { type: 'object', properties: {} },
    isDeferred: false,
  },
  {
    name: 'unlock',
    description:
      'Ask the user to unlock a locked test file, with the reason the test is wrong. The user answers in a dialog; only they can unlock.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'The locked file, relative to the repo root.' },
        reason: { type: 'string', description: 'Why the test is wrong, with the evidence.' },
      },
      required: ['file', 'reason'],
    },
    isDeferred: false,
  },
  {
    name: 'progress',
    description:
      "Tell the user which numbered step of the current phase's \"With the user\" section you are starting. The band above the prompt shows it. Not in build or inspect, whose steps the mod follows itself.",
    inputSchema: {
      type: 'object',
      properties: {
        step: { type: 'integer', minimum: 1, description: 'The number of the step you are starting, as the phase instructions number it.' },
      },
      required: ['step'],
    },
    isDeferred: false,
  },
  {
    name: 'finish',
    description:
      "Remove a finished workflow's worktree and local branch, once the user agreed to it in the mod's dialog and you left the worktree with ExitWorktree (action keep). The mod checks again that the worktree is clean and the branch pushed, and removes nothing otherwise.",
    inputSchema: { type: 'object', properties: {} },
    isDeferred: false,
  },
]

export async function registerToolsOnce($: EngineInterface, runtime: Runtime): Promise<void> {
  if (runtime.toolsRegistered) return
  runtime.toolsRegistered = true
  for (const tool of TOOLS) await $.tool.register(tool)
}

function textInput(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : ''
}

function listInput(input: Record<string, unknown>, key: string): string[] | undefined {
  const value = input[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

function currentOf(context: Context): Workflow {
  if (context.current === undefined) refuse('no workflow runs on this branch. /workflow continue <slug> picks one.')
  return context.current
}

async function handoff($: EngineInterface, context: Context, input: Record<string, unknown>, now: number): Promise<string> {
  const workflow = currentOf(context)
  const hasGoal = input.goal !== undefined
  if (hasGoal && workflow.phase !== 'intake') {
    refuse(`the goal is set in the intake phase only, and "${workflow.slug}" is in its ${workflow.phase} phase: call mcp__workflow__handoff again without it.`)
  }
  await saveWorkflow($, context.repo, context.paths, {
    ...workflow,
    goal: hasGoal ? textInput(input, 'goal') : workflow.goal,
    stopped: textInput(input, 'stopped'),
    next: textInput(input, 'next'),
    questions: listInput(input, 'questions') ?? [],
    paths: listInput(input, 'paths') ?? workflow.paths,
    updated: iso(now),
  })
  return 'Saved the handoff.'
}

function recommendationsOf(context: Context, workflow: Workflow, input: Record<string, unknown>): Recommendation[] {
  if (input.recommendations === undefined) return []
  if (workflow.phase !== 'intake') {
    refuse(
      `recommendations are taken on the intake's gate only, and "${workflow.slug}" is in its ${workflow.phase} phase: nothing moved. Call mcp__workflow__advance again without them.`,
    )
  }
  const parsed = parseRecommendations(input.recommendations, stepsOf(workflow, context.config === undefined))
  if ('errors' in parsed) {
    refuse(`the recommendations were refused, and nothing moved: ${parsed.errors.join('; ')}. Fix them and call mcp__workflow__advance again.`)
  }
  return parsed.recommendations
}

async function askPlan($: EngineInterface, workflow: Workflow, recommendations: readonly Recommendation[]): Promise<ModelPlan | 'per step'> {
  const options = recommendations.length > 0 ? [MODELS.defaults, MODELS.recommended, MODELS.perStep] : [MODELS.defaults, MODELS.perStep]
  const answer = await askOrUndefined($, MODELS.question, options, 'Models')
  if (answer === MODELS.perStep) return 'per step'
  if (answer === MODELS.recommended) return withRecommendations(DEFAULT_PLAN, recommendations)
  if (answer === MODELS.defaults) return DEFAULT_PLAN
  return workflow.models
}

function choosingPrompt(workflow: Workflow): string {
  return `Approved: "${workflow.slug}" is now in its ${workflow.phase} phase. The user is choosing each step's model and effort in the Models panel. End your turn now, with a Next: line saying they choose the models in the panel: the mod sends you the ${workflow.phase} phase prompt once they confirm or cancel.`
}

function stopWhileChoosing(workflow: Workflow): string {
  return `Approved: "${workflow.slug}" is now in its ${workflow.phase} phase, and the user stops here once they have chosen each step's model and effort in the Models panel. ${stopPrompt(workflow)}`
}

async function advance($: EngineInterface, runtime: Runtime, context: Context, input: Record<string, unknown>, now: number): Promise<string> {
  const workflow = currentOf(context)
  if (workflow.phase === 'build') {
    refuse('the build phase moves on by itself: each slice closes with mcp__workflow__verify, and the last one moves the workflow to inspect.')
  }
  if (workflow.phase === 'done') refuse(`the workflow "${workflow.slug}" is done.`)
  const recommendations = recommendationsOf(context, workflow, input)
  if (input.recommendations !== undefined) await rememberRecommendations($, workflow.slug, recommendations)
  const summary = textInput(input, 'summary')
  const target = phaseAfter(workflow.size, workflow.phase, context.config === undefined)
  let slice = workflow.slice
  if (target === 'build') {
    const open = (await readSlices($, context, workflow)).find(candidate => !candidate.done)
    if (open === undefined) refuse('slices.md has no slice left to build: write it, or fix its checkboxes, first.')
    slice = open.number
  }

  const answer = await askOrUndefined(
    $,
    `Approve the ${workflow.phase} phase of "${workflow.slug}" and move to ${target}?\n\n${summary}`,
    [GATE.approve, GATE.stop, GATE.wait],
    'Gate',
  )
  if (answer === undefined) return `The user closed the dialog: "${workflow.slug}" stays in its ${workflow.phase} phase.`
  if (answer !== GATE.approve && answer !== GATE.stop) {
    return `The user is not ready to leave the ${workflow.phase} phase (${answer}). Ask what should change.`
  }

  const isStopping = answer === GATE.stop
  const choice = workflow.phase === 'intake' ? await askPlan($, workflow, recommendations) : workflow.models
  const status = target === 'done' ? 'done' : isStopping ? 'paused' : 'active'
  let moved: Workflow = withLog({ ...inPhase(workflow, target), slice, status, updated: iso(now) }, day(now), `${workflow.phase} approved`)
  await saveWorkflow($, context.repo, context.paths, moved)
  if (!isStopping) announcePhase($, moved)
  if (choice !== 'per step') moved = await savePlan($, context, moved, choice, now)
  else {
    const chosen = await chooseModels($, context, moved, recommendations, isStopping ? 'stay' : 'phase')
    if (chosen === 'pane') {
      await refreshStatus($)
      await registerAgents($)
      return isStopping ? stopWhileChoosing(moved) : choosingPrompt(moved)
    }
    moved = chosen
  }
  await refreshStatus($)
  await registerAgents($)
  if (target === 'done') {
    const closed = `Approved: "${workflow.slug}" is done.`
    const ending = await offerEnding($, runtime, context, moved, now)
    if (ending.kind === 'leave') return `${closed}\n\n${ending.prompt}`
    return ending.text === '' ? closed : `${closed} ${ending.text}`
  }
  if (isStopping) return `Approved: "${workflow.slug}" is now in its ${target} phase, and the user stops here. ${stopPrompt(moved)}`
  submitLater($, `The ${target} phase of "${workflow.slug}" starts now. Go on with it in this conversation:\n\n${await phasePrompt($, context, moved)}`)
  return `Approved: "${workflow.slug}" is now in its ${target} phase. ${NEXT_IN_ITS_OWN_TURN} End your turn now, with a Next: line saying the ${target} phase starts right away.`
}

async function progress($: EngineInterface, context: Context, input: Record<string, unknown>, now: number): Promise<string> {
  const workflow = currentOf(context)
  if (workflow.phase === 'build' || workflow.phase === 'inspect') {
    refuse(`the mod follows the steps of the ${workflow.phase} phase itself: do not call mcp__workflow__progress in it.`)
  }
  const steps = (await readPhase($, workflow.phase)).steps
  const step = input.step
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 1 || step > steps.length) {
    refuse(
      `step must be a whole number from 1 to ${steps.length}, a numbered step of the ${workflow.phase} phase's "With the user" section; got ${JSON.stringify(step)}. Nothing changed.`,
    )
  }
  await saveWorkflow($, context.repo, context.paths, { ...workflow, step, updated: iso(now) })
  return `Step ${step} of ${steps.length} of the ${workflow.phase} phase: ${steps[step - 1]}.`
}

type ToolAnswer = { result: string } | { deny: string }

function failure(error: unknown): ToolAnswer {
  return { deny: error instanceof Refusal ? `workflow: ${error.message}` : `workflow: the tool failed: ${describe(error)}` }
}

async function contextOf($: EngineInterface): Promise<Context> {
  const context = await loadContext($)
  if (context === undefined) refuse('this session is not in a git repository.')
  return context
}

async function answered($: EngineInterface, text: string): Promise<ToolAnswer> {
  await refreshStatus($)
  return { result: text }
}

async function handoffTool($: EngineInterface, input: Record<string, unknown>): Promise<ToolAnswer> {
  try {
    return await answered($, await handoff($, await contextOf($), input, await $.clock.now()))
  } catch (error) {
    return failure(error)
  }
}

async function advanceTool($: EngineInterface, runtime: Runtime, input: Record<string, unknown>): Promise<ToolAnswer> {
  try {
    return await answered($, await advance($, runtime, await contextOf($), input, await $.clock.now()))
  } catch (error) {
    return failure(error)
  }
}

async function progressTool($: EngineInterface, input: Record<string, unknown>): Promise<ToolAnswer> {
  try {
    return await answered($, await progress($, await contextOf($), input, await $.clock.now()))
  } catch (error) {
    return failure(error)
  }
}

async function finishTool($: EngineInterface, runtime: Runtime): Promise<ToolAnswer> {
  try {
    return await answered($, await finish($, runtime, await contextOf($), await $.clock.now()))
  } catch (error) {
    return failure(error)
  }
}

async function lockTool($: EngineInterface): Promise<ToolAnswer> {
  try {
    const locked = await lockSlice($, await contextOf($), await $.clock.now())
    await clearVerified($)
    return await answered($, locked)
  } catch (error) {
    return failure(error)
  }
}

async function verifyTool($: EngineInterface, agentId: string | undefined): Promise<ToolAnswer> {
  try {
    const context = await contextOf($)
    const verified = await verifySlice($, context, await $.clock.now())
    if (verified.advanced.phase === 'inspect') announcePhase($, verified.advanced)
    else await markVerified($, verified.advanced, verified.slice)
    await registerAgents($)
    if (agentId === undefined) return await answered($, await verifiedForConversation($, context, verified))
    const slug = verified.advanced.slug
    await update($, handovers, pending => ({ ...pending, [agentId]: slug }))
    return await answered($, verifiedForAgent(verified))
  } catch (error) {
    return failure(error)
  }
}

async function takeHandover($: EngineInterface, agentId: string): Promise<string | undefined> {
  const slug = (await read($, handovers))[agentId]
  if (slug === undefined) return undefined
  await update($, handovers, pending => Object.fromEntries(Object.entries(pending).filter(([id]) => id !== agentId)))
  return slug
}

async function handOver($: EngineInterface, agentId: string): Promise<void> {
  try {
    const slug = await takeHandover($, agentId)
    if (slug === undefined) return
    await clearVerified($)
    const context = await contextOf($)
    const workflow = context.workflows.find(candidate => candidate.slug === slug)
    if (workflow === undefined) return
    submitLater($, `The \`workflow:build\` agent's run has ended after a verified slice of \`${slug}\`. Next:\n\n${(await nextStep($, context, workflow)).text}`)
    await refreshStatus($)
  } catch (error) {
    $.ui.log(`workflow: the next step after workflow:build could not be handed over: ${describe(error)}`, { to: 'debug' })
  }
}

async function unlockTool($: EngineInterface, input: Record<string, unknown>): Promise<ToolAnswer> {
  try {
    const context = await contextOf($)
    return await answered($, await unlockFile($, context, textInput(input, 'file'), textInput(input, 'reason'), false, await $.clock.now()))
  } catch (error) {
    return failure(error)
  }
}

function inputOf(e: unknown): Record<string, unknown> {
  return typeof e === 'object' && e !== null ? (e as Record<string, unknown>) : {}
}

function refusedInStepAgent(tool: string): ToolAnswer {
  return {
    deny: `workflow: ${tool} is refused in a step agent: only the conversation moves the workflow, hands it off and asks the user. Put what it needs in your report.`,
  }
}

export function registerToolHandlers(on: On, runtime: Runtime): void {
  on('tool.call', { tool: 'mcp__workflow__handoff' }, ($, e) =>
    e.agentId === undefined ? handoffTool($, inputOf(e)) : refusedInStepAgent(e.tool),
  )
  on('tool.call', { tool: 'mcp__workflow__advance' }, ($, e) =>
    e.agentId === undefined ? advanceTool($, runtime, inputOf(e)) : refusedInStepAgent(e.tool),
  )
  on('tool.call', { tool: 'mcp__workflow__lock' }, $ => lockTool($))
  on('tool.call', { tool: 'mcp__workflow__verify' }, ($, e) => verifyTool($, e.agentId))
  on('tool.call', { tool: 'mcp__workflow__unlock' }, ($, e) =>
    e.agentId === undefined ? unlockTool($, inputOf(e)) : refusedInStepAgent(e.tool),
  )
  on('tool.call', { tool: 'mcp__workflow__progress' }, ($, e) =>
    e.agentId === undefined ? progressTool($, inputOf(e)) : refusedInStepAgent(e.tool),
  )
  on('tool.call', { tool: 'mcp__workflow__finish' }, ($, e) =>
    e.agentId === undefined ? finishTool($, runtime) : refusedInStepAgent(e.tool),
  )
  on('tool.call', { tool: 'EnterWorktree' }, async ($, e, next) => {
    const entered = await next(e)
    if (e.agentId === undefined && e.tool === 'EnterWorktree' && entered.deny === undefined && entered.isError !== true && typeof e.path === 'string') {
      await rememberEnteredWorktree($, e.path)
    }
    return entered
  })
  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    if (e.agentId !== undefined) {
      await handOver($, e.agentId)
      await endReviewRound($, { reason: e.reason, agentId: e.agentId })
    } else {
      await turnEnded($)
    }
    return ended
  })
}
