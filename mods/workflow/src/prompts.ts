import type { EngineInterface } from 'claude-code'

import type { Config } from './config'
import { pipelineOf, readDoc, readSlices, specsFolder } from './context'
import type { Context } from './context'
import { PRODUCES } from './labels'
import { STEP_SOURCES, readPhase, stepOf, stepsOf } from './phases'
import { DEFAULT_PLAN, describeChoice } from './plan'
import type { Step } from './plan'
import { sections } from './slices'
import { MAX_REVIEW_ROUNDS, reviewRoundOf } from './state'
import type { Workflow } from './state'

function bulletOr(items: readonly string[], none: string): string {
  return items.length > 0 ? items.join('; ') : none
}

function standing(workflow: Workflow): string {
  return [
    '## Where the workflow stands',
    '',
    `- Goal: ${workflow.goal || '(not written yet)'}`,
    `- Where we stopped: ${workflow.stopped || '(nothing yet)'}`,
    `- Next action: ${workflow.next || '(decide it from the phase instructions)'}`,
    `- Open questions: ${bulletOr(workflow.questions, 'none')}`,
    `- Documents: ${bulletOr(workflow.docs, 'none yet')}`,
  ].join('\n')
}

function files($: EngineInterface, specs: string): string {
  return [
    '## Files',
    '',
    `- This workflow's documents: \`${specs}/\``,
    `- Guides the phase names: \`${$.plugin.root}/guides/\``,
    `- Templates: \`${$.plugin.root}/templates/\``,
  ].join('\n')
}

function checks(config: Config | undefined): string | undefined {
  if (config === undefined) return undefined
  const sliceTests = config.commands.testFiles ?? config.commands.test
  const red = sliceTests.includes('{files}')
    ? `run \`${sliceTests}\` with this slice's test files in place of \`{files}\`, sorted and separated by spaces`
    : `run \`${sliceTests}\``
  const green = [config.commands.lint, config.commands.typecheck, config.commands.test].filter(
    (command): command is string => command !== undefined,
  )
  return [
    '## Checks',
    '',
    `- Red: ${red}, exactly as written with nothing appended, then call mcp__workflow__lock.`,
    `- Green: once the slice tests pass, run ${green.map(command => `\`${command}\``).join(', ')} exactly as written, then call mcp__workflow__verify.`,
    ...(config.packages.length > 0 ? ['- A file inside a package uses that package\'s commands from `.claude/workflow.json`; lock names them.'] : []),
  ].join('\n')
}

function missingSlice(workflow: Workflow): string {
  return `## Slice ${workflow.slice}\n\n\`slices.md\` has no slice ${workflow.slice}. Tell the user, and stop.`
}

async function currentSlice($: EngineInterface, context: Context, workflow: Workflow): Promise<string> {
  const slices = await readSlices($, context, workflow)
  const slice = slices.find(candidate => candidate.number === workflow.slice)
  if (slice === undefined) return missingSlice(workflow)
  const design = (await readDoc($, context, workflow, 'design.md')) ?? ''
  const needed = sections(design, slice.designSections)
  return [
    `## This slice (${slice.number} of ${slices.length})`,
    '',
    slice.text,
    '',
    '## Design sections it needs',
    '',
    needed.length > 0 ? needed : '(the slice names none)',
  ].join('\n')
}

async function sliceNamed($: EngineInterface, context: Context, workflow: Workflow): Promise<string> {
  const slices = await readSlices($, context, workflow)
  const slice = slices.find(candidate => candidate.number === workflow.slice)
  if (slice === undefined) return missingSlice(workflow)
  return [
    '## This slice',
    '',
    `Slice ${slice.number}: ${slice.name} (${slice.number} of ${slices.length}). The build agent holds its text, its design sections and the checks.`,
  ].join('\n')
}

function header(workflow: Workflow): string[] {
  const slice = workflow.phase === 'build' ? `, slice ${workflow.slice}` : ''
  return [
    `# Workflow: ${workflow.title}`,
    `You are working on the workflow \`${workflow.slug}\` (${workflow.size}), phase ${workflow.phase}${slice}, on branch \`${workflow.branch}\`. The workflow mod keeps its state: change it only through the mcp__workflow__* tools. Commits after each slice: ${workflow.commits ? 'yes' : 'no, the user commits'}.`,
  ]
}

export function spawnBuild(workflow: Workflow): string {
  const { model, effort } = workflow.models.build
  return `Spawn \`workflow:build\` with the Agent tool to build slice ${workflow.slice}, in the foreground, with the prompt "Build slice ${workflow.slice} of \`${workflow.slug}\`." It runs on ${model} with ${effort} effort and already holds the slice, the design sections and the checks. Wait for it, then relay its report to the user: what it built, each check and its result, whether mcp__workflow__verify closed the slice, and its open questions.`
}

function buildAgent(workflow: Workflow): string {
  return [
    '## The build agent',
    '',
    spawnBuild(workflow),
    '',
    'Once its run ends after a verified slice, the mod sends you the next step in a message of its own: end your turn after the relay and wait for it.',
  ].join('\n')
}

function stepAgent(workflow: Workflow, step: Step): string {
  const { model, effort } = workflow.models[step]
  return [
    '## The agent',
    '',
    `This phase's work runs in \`workflow:${step}\`, on ${model} with ${effort} effort. Spawn it with the Agent tool, in the foreground, at each step above that names it, with a prompt that says which part to do and carries the user's answers it needs: it already holds its instructions and this workflow's documents folder. Wait for it, then relay its report to the user and ask them its open questions. Do its work yourself only when it cannot run.`,
  ].join('\n')
}

function mapAgent(workflow: Workflow): string | undefined {
  if (workflow.phase !== 'design' || workflow.size !== 'feature') return undefined
  return [
    '## The map agent',
    '',
    `This workflow is a feature, with no spec to start from: open the phase by asking the user with AskUserQuestion whether to map the project first, with the options "Yes, map the project first (Recommended)" and "No, start the design". On yes, spawn \`workflow:map\` with the Agent tool, in the foreground, on ${describeChoice(workflow.models.map)}: it writes a \`## Context\` section at the top of this workflow's \`design.md\` (the structure, the conventions, the code the change touches and what it may affect). Relay what it found, then go on with the research; \`workflow:design\` starts from that section.`,
  ].join('\n')
}

function reviewRounds(workflow: Workflow): string | undefined {
  if (workflow.phase !== 'inspect') return undefined
  return [
    '## Review rounds',
    '',
    `- ${reviewRoundOf(workflow)} of ${MAX_REVIEW_ROUNDS} review rounds have ended in this workflow. The mod counts one each time a \`workflow:review\` run ends; the loop stops at ${MAX_REVIEW_ROUNDS}.`,
    `- Fixes run in \`workflow:build\`, on ${describeChoice(workflow.models.build)}: spawn it in the foreground with the findings to fix and wait for its report. In this phase it fixes them test-first without the slice lock, then runs every check.`,
  ].join('\n')
}

function fixing(config: Config | undefined): string {
  const commands = config === undefined ? [] : [config.commands.lint, config.commands.typecheck, config.commands.test]
  const checks = commands.filter((command): command is string => command !== undefined).map(command => `\`${command}\``)
  return [
    '## Fixing review findings',
    '',
    'The workflow is in its inspect phase: your prompt names review findings to fix, not a slice. Leave out the lock and verify steps above: mcp__workflow__lock and mcp__workflow__verify belong to the build phase and are refused here, so the discipline is yours.',
    '',
    '1. For each finding, write the failing test that shows it first (a bug found in review gets its failing test before its fix), run it and read the failure: it must fail for the reason the finding names.',
    '2. Fix it with the smallest change, and run the test again.',
    `3. Run every check, exactly as written, with nothing appended, until each passes: ${checks.length > 0 ? checks.join(', ') : "the project's lint, typecheck and full test suite"}.`,
    '4. Report each finding with the test that covers it, and each check with its result. An existing test changes only with a reason the user agrees with: stop and put it in your open questions.',
  ].join('\n')
}

function agentPart(workflow: Workflow, step: Step | undefined): string | undefined {
  if (step === undefined) return undefined
  return step === 'build' ? buildAgent(workflow) : stepAgent(workflow, step)
}

function leading(context: Context, workflow: Workflow): string | undefined {
  if (workflow.phase === 'done') return undefined
  const phases = pipelineOf(context, workflow)
  return [
    '## Leading the user',
    '',
    `- Open the phase by telling the user where they are: step ${phases.indexOf(workflow.phase) + 1} of ${phases.length} of this workflow (${phases.join(', ')}), what this phase produces (${PRODUCES[workflow.phase]}), and what they will be asked in it.`,
    '- Ask every decision the user owns with AskUserQuestion, your recommended option first with "(Recommended)" after its label. Never leave a decision as an open question in chat.',
    '- End every turn with a line starting "Next:" that says what happens next and whether the user has to act.',
  ].join('\n')
}

function defaultModels(context: Context, workflow: Workflow): string {
  return [
    '## Default models',
    '',
    "Each later step of this workflow runs in its own agent. The mod's default model and effort for each:",
    '',
    ...stepsOf(workflow, context.config === undefined).map(step => `- ${step}: ${describeChoice(DEFAULT_PLAN[step])}`),
  ].join('\n')
}

function joined(parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join('\n\n')
}

export async function phasePrompt(
  $: EngineInterface,
  context: Context,
  workflow: Workflow,
  drift?: string,
): Promise<string> {
  const doc = await readPhase($, workflow.phase)
  const step = doc.agents.Agent === undefined ? undefined : stepOf(workflow.phase)
  const isBuilding = workflow.phase === 'build'
  return joined([
    ...header(workflow),
    leading(context, workflow),
    drift,
    doc.body,
    workflow.phase === 'intake' ? defaultModels(context, workflow) : undefined,
    mapAgent(workflow),
    agentPart(workflow, step),
    reviewRounds(workflow),
    standing(workflow),
    files($, specsFolder(context, workflow)),
    isBuilding ? await sliceNamed($, context, workflow) : undefined,
  ])
}

export async function agentInstructions(
  $: EngineInterface,
  context: Context,
  workflow: Workflow,
  step: Step,
): Promise<string | undefined> {
  const source = STEP_SOURCES[step]
  const section = (await readPhase($, source.phase)).agents[source.section]
  if (section === undefined) return undefined
  const isBuilding = step === 'build' && workflow.phase === 'build'
  const isFixing = step === 'build' && workflow.phase === 'inspect'
  return joined([
    ...header(workflow),
    section,
    isFixing ? fixing(context.config) : undefined,
    files($, specsFolder(context, workflow)),
    isBuilding ? await currentSlice($, context, workflow) : undefined,
    isBuilding ? checks(context.config) : undefined,
  ])
}

export async function setupPrompt($: EngineInterface): Promise<string> {
  const doc = await readPhase($, 'setup')
  return joined([
    '# Workflow setup',
    'This project has no `.claude/workflow.json` yet. Set it up so workflows can run here. No workflow runs yet, so no agent does it for you: do the work below yourself, ask the user in one AskUserQuestion batch what only they know (the test level, the invariants that must never break, the conventions you are unsure of), then show them the three files to review.',
    doc.preamble,
    doc.agents.Agent ?? doc.body,
    `Templates: \`${$.plugin.root}/templates/\``,
  ])
}

export function enterWorktreePrompt(workflow: Workflow, intake: string): string {
  return joined([
    '# Move into the worktree',
    `The workflow \`${workflow.slug}\` runs in its own worktree. Call the EnterWorktree tool with \`path\` set to \`${workflow.worktree}\`. Once you are in it, start the intake below.`,
    `If EnterWorktree is refused or fails, do not start the intake: tell the user to start a session in \`${workflow.worktree}\` and run \`/workflow continue ${workflow.slug}\` there.`,
    intake,
  ])
}

export function pausePrompt(workflow: Workflow): string {
  return `Pause the workflow \`${workflow.slug}\`: call mcp__workflow__handoff now with where you stopped, the next concrete action and any open questions. Then stop and tell the user it is paused and how to resume (\`/workflow continue ${workflow.slug}\`).`
}

export function stopPrompt(workflow: Workflow): string {
  return `Call mcp__workflow__handoff now with where things stand and the next action. Then stop and tell the user that \`/workflow continue ${workflow.slug}\` picks the workflow up from here.`
}
