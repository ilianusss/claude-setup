import type { EngineInterface } from 'claude-code'

import type { Config } from './config'
import { readDoc, readSlices, specsFolder } from './context'
import type { Context } from './context'
import { readPhase } from './phases'
import { sections } from './slices'
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

async function currentSlice($: EngineInterface, context: Context, workflow: Workflow): Promise<string> {
  const slices = await readSlices($, context, workflow)
  const slice = slices.find(candidate => candidate.number === workflow.slice)
  if (slice === undefined) {
    return `## Slice ${workflow.slice}\n\n\`slices.md\` has no slice ${workflow.slice}. Tell the user, and stop.`
  }
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

function header(workflow: Workflow): string[] {
  const slice = workflow.phase === 'build' ? `, slice ${workflow.slice}` : ''
  return [
    `# Workflow: ${workflow.title}`,
    `You are working on the workflow \`${workflow.slug}\` (${workflow.size}), phase ${workflow.phase}${slice}, on branch \`${workflow.branch}\`. The workflow mod keeps its state: change it only through the mcp__workflow__* tools. Commits after each slice: ${workflow.commits ? 'yes' : 'no, the user commits'}.`,
  ]
}

function buildAgent(workflow: Workflow): string {
  const { model, effort } = workflow.models.build
  return [
    '## The build agent',
    '',
    `Spawn \`workflow:build\` with the Agent tool to build slice ${workflow.slice}, in the foreground, with the prompt "Build slice ${workflow.slice} of \`${workflow.slug}\`." It runs on ${model} with ${effort} effort and already holds the slice, the design sections and the checks below. Wait for it, then relay its report to the user: what it built, each check and its result, the answer of mcp__workflow__verify, and its open questions.`,
  ].join('\n')
}

const INTAKE_STEPS = [
  '## The intake steps',
  '',
  '1. **Ask** the user, in their words:',
  '   - The problem: what is wrong or missing today, and for whom.',
  '   - The result wanted: what exists once this workflow is done.',
  '   - How success will show: what the user will see, run or measure to know it worked.',
  '   - The limits: time, technology, compatibility, and what must not change.',
  '   - Out of scope: what this workflow will not do.',
  '2. **Restate** your understanding in a few lines, one per point above, and ask the user to confirm it or correct it. Restate again after each correction, until they confirm.',
  '3. **Save.** Call mcp__workflow__handoff with `goal` set to the confirmed restatement, and the next action.',
  '4. **Gate.** Call mcp__workflow__advance with the confirmed restatement as the summary.',
].join('\n')

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
  const specs = specsFolder(context, workflow)
  const parts = [
    ...header(workflow),
    drift,
    doc.body,
    workflow.phase === 'intake' ? INTAKE_STEPS : undefined,
    workflow.phase === 'build' ? buildAgent(workflow) : undefined,
    standing(workflow),
    files($, specs),
    workflow.phase === 'build' ? await currentSlice($, context, workflow) : undefined,
    workflow.phase === 'build' ? checks(context.config) : undefined,
  ]
  return joined(parts)
}

export async function agentInstructions($: EngineInterface, context: Context, workflow: Workflow): Promise<string | undefined> {
  const doc = await readPhase($, workflow.phase)
  if (doc.agent === undefined) return undefined
  return joined([
    ...header(workflow),
    doc.agent,
    files($, specsFolder(context, workflow)),
    workflow.phase === 'build' ? await currentSlice($, context, workflow) : undefined,
    workflow.phase === 'build' ? checks(context.config) : undefined,
  ])
}

export async function setupPrompt($: EngineInterface): Promise<string> {
  const doc = await readPhase($, 'setup')
  return [
    '# Workflow setup',
    'This project has no `.claude/workflow.json` yet. Set it up so workflows can run here.',
    doc.body,
    `Templates: \`${$.plugin.root}/templates/\``,
  ].join('\n\n')
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
