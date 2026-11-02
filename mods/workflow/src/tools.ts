import type { EngineInterface, On, RegisteredToolSpec } from 'claude-code'

import { askOrUndefined } from './ask'
import { lockSlice, unlockFile, verifySlice } from './build'
import { day, iso } from './clock'
import { loadContext, readSlices } from './context'
import type { Context } from './context'
import { GATE } from './labels'
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
  await saveWorkflow($, context.repo, context.paths, {
    ...workflow,
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
  const target = phaseAfter(workflow.size, workflow.phase)
  let slice = workflow.slice
  if (target === 'build') {
    const open = (await readSlices($, context, workflow)).find(candidate => !candidate.done)
    if (open === undefined) refuse('slices.md has no slice left to build: write it, or fix its checkboxes, first.')
    slice = open.number
  }

  const answer = await askOrUndefined(
    $,
    `Approve the ${workflow.phase} phase of "${workflow.slug}" and move to ${target}?\n\n${summary}`,
    [GATE.approve, GATE.wait],
    'Gate',
  )
  if (answer === undefined) return `The user closed the dialog: "${workflow.slug}" stays in its ${workflow.phase} phase.`
  if (answer !== GATE.approve) return `The user is not ready to leave the ${workflow.phase} phase (${answer}). Ask what should change.`

  const moved: Workflow = { ...workflow, phase: target, slice, status: target === 'done' ? 'done' : workflow.status, updated: iso(now) }
  await saveWorkflow($, context.repo, context.paths, withLog(moved, day(now), `${workflow.phase} approved`))
  await refreshStatus($)
  if (target === 'done') return `Approved: "${workflow.slug}" is done.`
  return `Approved: "${workflow.slug}" is now in its ${target} phase. Call mcp__workflow__handoff with the next action, then tell the user that /workflow next starts ${target} in a fresh context.`
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

async function verifyTool($: EngineInterface, runtime: Runtime): Promise<ToolAnswer> {
  try {
    const context = await contextOf($)
    const verified = await verifySlice($, context, await $.clock.now())
    if (verified.chainNext) runtime.pendingNext = context.current?.slug
    return await answered($, verified.text)
  } catch (error) {
    return failure(error)
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

export function registerToolHandlers(on: On, runtime: Runtime): void {
  on('tool.call', { tool: 'mcp__workflow__handoff' }, ($, e) => handoffTool($, inputOf(e)))
  on('tool.call', { tool: 'mcp__workflow__advance' }, ($, e) => advanceTool($, inputOf(e)))
  on('tool.call', { tool: 'mcp__workflow__lock' }, $ => lockTool($))
  on('tool.call', { tool: 'mcp__workflow__verify' }, $ => verifyTool($, runtime))
  on('tool.call', { tool: 'mcp__workflow__unlock' }, ($, e) => unlockTool($, inputOf(e)))
}
