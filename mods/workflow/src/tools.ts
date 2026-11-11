import type { EngineInterface, On, RegisteredToolSpec } from 'claude-code'

import { registerAgents } from './agents'
import { askOrUndefined } from './ask'
import { lockSlice, nextStep, unlockFile, verifiedForAgent, verifiedForConversation, verifySlice } from './build'
import { day, iso, submitLater } from './clock'
import { loadContext, readSlices } from './context'
import type { Context } from './context'
import { GATE } from './labels'
import { phasePrompt, stopPrompt } from './prompts'
import { Refusal, describe, refuse } from './refusal'
import type { Runtime } from './runtime'
import { phaseAfter, withLog } from './state'
import type { Workflow } from './state'
import { refreshStatus } from './status'
import { saveWorkflow } from './store'

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
      properties: { summary: { type: 'string', description: 'What the phase produced, for the user to approve.' } },
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

async function advance($: EngineInterface, context: Context, summary: string, now: number): Promise<string> {
  const workflow = currentOf(context)
  if (workflow.phase === 'build') {
    refuse('the build phase moves on by itself: each slice closes with mcp__workflow__verify, and the last one moves the workflow to inspect.')
  }
  if (workflow.phase === 'done') refuse(`the workflow "${workflow.slug}" is done.`)
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

  const status = target === 'done' ? 'done' : answer === GATE.stop ? 'paused' : workflow.status
  const moved: Workflow = { ...workflow, phase: target, slice, status, updated: iso(now) }
  await saveWorkflow($, context.repo, context.paths, withLog(moved, day(now), `${workflow.phase} approved`))
  await refreshStatus($)
  await registerAgents($)
  if (target === 'done') return `Approved: "${workflow.slug}" is done.`
  if (answer === GATE.stop) return `Approved: "${workflow.slug}" is now in its ${target} phase, and the user stops here. ${stopPrompt(moved)}`
  return `Approved: "${workflow.slug}" is now in its ${target} phase. Go straight on with it in this conversation:\n\n${await phasePrompt($, context, moved)}`
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

async function advanceTool($: EngineInterface, input: Record<string, unknown>): Promise<ToolAnswer> {
  try {
    return await answered($, await advance($, await contextOf($), textInput(input, 'summary'), await $.clock.now()))
  } catch (error) {
    return failure(error)
  }
}

async function lockTool($: EngineInterface): Promise<ToolAnswer> {
  try {
    return await answered($, await lockSlice($, await contextOf($), await $.clock.now()))
  } catch (error) {
    return failure(error)
  }
}

async function verifyTool($: EngineInterface, runtime: Runtime, agentId: string | undefined): Promise<ToolAnswer> {
  try {
    const context = await contextOf($)
    const verified = await verifySlice($, context, await $.clock.now())
    await registerAgents($)
    if (agentId === undefined) return await answered($, await verifiedForConversation($, context, verified))
    runtime.handovers.set(agentId, verified.advanced.slug)
    return await answered($, verifiedForAgent(verified))
  } catch (error) {
    return failure(error)
  }
}

async function handOver($: EngineInterface, runtime: Runtime, agentId: string): Promise<void> {
  const slug = runtime.handovers.get(agentId)
  if (slug === undefined) return
  runtime.handovers.delete(agentId)
  try {
    const context = await contextOf($)
    const workflow = context.workflows.find(candidate => candidate.slug === slug)
    if (workflow === undefined) return
    submitLater($, `The \`workflow:build\` agent's run has ended after a verified slice of \`${slug}\`. Next:\n\n${await nextStep($, context, workflow)}`)
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
    e.agentId === undefined ? advanceTool($, inputOf(e)) : refusedInStepAgent(e.tool),
  )
  on('tool.call', { tool: 'mcp__workflow__lock' }, $ => lockTool($))
  on('tool.call', { tool: 'mcp__workflow__verify' }, ($, e) => verifyTool($, runtime, e.agentId))
  on('tool.call', { tool: 'mcp__workflow__unlock' }, ($, e) =>
    e.agentId === undefined ? unlockTool($, inputOf(e)) : refusedInStepAgent(e.tool),
  )
  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    if (e.agentId !== undefined) await handOver($, runtime, e.agentId)
    return ended
  })
}
