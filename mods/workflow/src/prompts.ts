import type { EngineInterface } from 'claude-code'

import type { Config } from './config'
import { pipelineOf, readDoc, readSlices, specsFolder } from './context'
import type { Context } from './context'
import { PRODUCES, PUBLISH } from './labels'
import { STEP_SOURCES, readPhase, stepOf, stepsOf } from './phases'
import type { PhaseDoc } from './phases'
import { DEFAULT_PLAN, describeChoice } from './plan'
import type { Step } from './plan'
import { describe } from './refusal'
import { readySlices, sections, waves } from './slices'
import type { Slice } from './slices'
import { MAX_LANES, MAX_REVIEW_ROUNDS, reviewRoundOf } from './state'
import { runningSlices } from './running'
import { buildsInLanes } from './store'
import { buildTask } from './tasks'
import type { Workflow } from './state'

const CONTINUE_COMMAND = '/workflow continue'

export async function fillContinue($: EngineInterface): Promise<boolean> {
  try {
    return (await $.prompt.fill({ text: CONTINUE_COMMAND })).isFilled
  } catch (error) {
    $.ui.log(`workflow: ${CONTINUE_COMMAND} could not be put in the prompt box: ${describe(error)}`, { to: 'debug' })
    return false
  }
}

export function endWithContinue(starts: string, isFilled: boolean): string {
  const where = isFilled ? 'it is already in their prompt box, they press Enter' : 'the mod could not put it in their prompt box, so they type it'
  return `End your turn now, with a line starting "Next:" that tells the user to run \`${CONTINUE_COMMAND}\` to ${starts} (${where}). Never say the user has nothing to do.`
}

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

export function greenChecks(config: Config | undefined): string {
  const commands = config === undefined ? [] : [config.commands.lint, config.commands.typecheck, config.commands.test]
  const green = commands.filter((command): command is string => command !== undefined).map(command => `\`${command}\``)
  return green.length > 0 ? green.join(', ') : "the project's lint, typecheck and full test suite"
}

function checks(config: Config | undefined): string | undefined {
  if (config === undefined) return undefined
  const sliceTests = config.commands.testFiles ?? config.commands.test
  const red = sliceTests.includes('{files}')
    ? `run \`${sliceTests}\` with this slice's test files in place of \`{files}\`, sorted and separated by spaces`
    : `run \`${sliceTests}\``
  return [
    '## Checks',
    '',
    `- Red: ${red}, exactly as written with nothing appended, then call mcp__workflow__lock.`,
    `- Green: once the slice tests pass, run ${greenChecks(config)} exactly as written, then call mcp__workflow__verify.`,
    ...(config.packages.length > 0 ? ['- A file inside a package uses that package\'s commands from `.claude/workflow.json`; lock names them.'] : []),
  ].join('\n')
}

function missingSlice(number: number): string {
  return `## Slice ${number}\n\n\`slices.md\` has no slice ${number}. Tell the user, and stop.`
}

export async function sliceSections($: EngineInterface, context: Context, workflow: Workflow, number: number): Promise<string> {
  const slices = await readSlices($, context, workflow)
  const slice = slices.find(candidate => candidate.number === number)
  if (slice === undefined) return missingSlice(number)
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
  if (slice === undefined) return missingSlice(workflow.slice)
  return [
    '## This slice',
    '',
    `Slice ${slice.number}: ${slice.name} (${slice.number} of ${slices.length}). The build agent holds the checks, and the mod adds the slice's text and design sections to its prompt when you spawn it.`,
  ].join('\n')
}

function header(workflow: Workflow): string[] {
  const slice = workflow.phase === 'build' && !workflow.commits ? `, slice ${workflow.slice}` : ''
  return [
    `# Workflow: ${workflow.title}`,
    `You are working on the workflow \`${workflow.slug}\` (${workflow.size}), phase ${workflow.phase}${slice}, on branch \`${workflow.branch}\`. The workflow mod keeps its state: change it only through the mcp__workflow__* tools. Commits after each slice: ${workflow.commits ? 'yes' : 'no, the user commits'}.`,
  ]
}

function askedAbout(workflow: Workflow): string {
  if (workflow.technical) {
    return workflow.prompting === 'all' ? 'every decision, product and technical' : 'the major decisions only, product and technical'
  }
  return workflow.prompting === 'all'
    ? 'every product and design decision, and about no technical one'
    : 'the major product and design decisions only, and about no technical one'
}

function asksEverything(workflow: Workflow): boolean {
  return workflow.prompting === 'all' && workflow.technical
}

function guidePath($: EngineInterface): string {
  return `\`${$.plugin.root}/guides/decision-guide.md\``
}

function whatToAsk($: EngineInterface, workflow: Workflow): string {
  const settings = `This workflow asks the user about ${askedAbout(workflow)}.`
  if (asksEverything(workflow)) return ['## What to ask the user', '', `${settings} Ask each one as the steps below say.`].join('\n')
  return [
    '## What to ask the user',
    '',
    [
      settings,
      `${guidePath($)} defines, in its Prompting level section, a major decision and what is product and design rather than technical.`,
      "A decision these settings leave out is not asked, whatever a step below says: take your recommended option, record it where the phase records its decisions (the spec's Decisions taken, the design's Decision and its ADRs), and tell the user in one line what you chose.",
      ...(workflow.technical
        ? []
        : [
            'The mod moves past the gates of the technical phases (setup, design, slice, inspect) without a dialog: still call mcp__workflow__advance at their end.',
          ]),
      'Always asked, whatever the settings: the unlock of a locked test, the push of the branch and the pull request, and the removal of the worktree.',
    ].join(' '),
  ].join('\n')
}

function whatTheUserIsAsked($: EngineInterface, workflow: Workflow): string {
  const settings = `This workflow asks the user about ${askedAbout(workflow)}.`
  if (asksEverything(workflow)) {
    return ['## What the user is asked', '', `${settings} Put each decision that belongs to the user in your open questions.`].join('\n')
  }
  return [
    '## What the user is asked',
    '',
    [
      settings,
      `${guidePath($)} defines, in its Prompting level section, a major decision and what is product and design rather than technical.`,
      "Put in your open questions only the decisions the user is asked about. For any other, take your recommended option, record it where your phase records its decisions (the spec's Decisions taken, the design's Decision and its ADRs), and list it in your report under Done.",
      ...(workflow.technical ? [] : ['A test that looks wrong still goes in your open questions: only the user unlocks it.']),
    ].join(' '),
  ].join('\n')
}

export function spawnBuild(workflow: Workflow): string {
  const { model, effort } = workflow.models.build
  return `Spawn \`workflow:build\` with the Agent tool to build slice ${workflow.slice}, in the foreground, with the prompt "${buildTask(workflow.slug, workflow.slice)}" It runs on ${model} with ${effort} effort and holds the checks; the mod adds the slice and its design sections to its prompt. Wait for it, then relay its report to the user: what it built, each check and its result, whether mcp__workflow__verify closed the slice, and its open questions.`
}

export function spawnLanes(workflow: Workflow, tasks: readonly string[]): string {
  const { model, effort } = workflow.models.build
  return [
    `Spawn ${tasks.length === 1 ? 'this' : 'these'} in one message, each with the Agent tool as \`workflow:build\` in the background (\`run_in_background: true\`), on ${model} with ${effort} effort, each with exactly this prompt:`,
    '',
    ...tasks.map(task => `- "${task}"`),
    '',
    'The mod sends each into its own worktree and branch, with its slice. Then end your turn, telling the user that the slices build in parallel and that the mod reports each as it ends: nothing is needed from them unless a question comes up. Relay each report as it comes.',
  ].join('\n')
}

// Each lane left without an agent goes on, then each ready slice starts while lanes are free. A verified lane needs no
// agent: it waits for the mod to merge it.
export function laneTasks(workflow: Workflow, slices: readonly Slice[], running: readonly number[]): string[] {
  const resumed = workflow.lanes.filter(lane => !lane.verified && !running.includes(lane.slice)).map(lane => buildTask(workflow.slug, lane.slice))
  const free = Math.max(MAX_LANES - workflow.lanes.length, 0)
  const ready = readySlices(slices, workflow.lanes.map(lane => lane.slice), free).map(slice => buildTask(workflow.slug, slice.number))
  return [...resumed, ...ready]
}

// No lane runs and no slice can start: the build waits on slices.md, which the user has to see fixed.
export function stuckReason(slices: readonly Slice[]): string {
  const graph = waves(slices)
  const done = new Set(slices.filter(slice => slice.done).map(slice => slice.number))
  const problems =
    'errors' in graph
      ? graph.errors
      : slices.filter(slice => !slice.done).map(slice => `slice ${slice.number} waits for slice ${slice.dependsOn.filter(dependency => !done.has(dependency)).join(', ')}`)
  return `No slice can start and no lane runs: ${problems.join('; ')}. Tell the user and fix slices.md with them, or spawn \`workflow:slice\` to fix it; then \`/workflow continue\` starts the ready slices.`
}

async function buildLanes($: EngineInterface, context: Context, workflow: Workflow): Promise<string> {
  const slices = await readSlices($, context, workflow)
  const tasks = laneTasks(workflow, slices, await runningSlices($, workflow.slug))
  return [
    '## The build agents',
    '',
    `This workflow commits, so its slices build in parallel, at most ${MAX_LANES} at a time, each in its own git worktree and branch made from \`${workflow.branch}\`. Once a lane's agent verified its slice and its run ended, the mod merges the lane into \`${workflow.branch}\`, ticks the slice and sends you the next step in a message of its own.`,
    '',
    tasks.length > 0
      ? spawnLanes(workflow, tasks)
      : workflow.lanes.length > 0
        ? 'No slice can start now: wait for the running lanes, the mod reports each as it ends.'
        : stuckReason(slices),
  ].join('\n')
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

function mapOffer(workflow: Workflow): string {
  return workflow.technical
    ? 'open the phase by asking the user with AskUserQuestion whether to map the project first, with the options "Yes, map the project first (Recommended)" and "No, start the design". On yes, spawn'
    : 'technical decisions are off, so open the phase by mapping the project without asking, the recommended answer, and tell the user so in one line. Spawn'
}

function mapAgent(workflow: Workflow): string | undefined {
  if (workflow.phase !== 'design' || workflow.size !== 'feature') return undefined
  return [
    '## The map agent',
    '',
    `This workflow is a feature, with no spec to start from: ${mapOffer(workflow)} \`workflow:map\` with the Agent tool, in the foreground, on ${describeChoice(workflow.models.map)}: it writes a \`## Context\` section at the top of this workflow's \`design.md\` (the structure, the conventions, the code the change touches and what it may affect). Relay what it found, then go on with the research; \`workflow:design\` starts from that section.`,
  ].join('\n')
}

function reviewRounds(workflow: Workflow): string | undefined {
  if (workflow.phase !== 'inspect') return undefined
  return [
    '## Review rounds',
    '',
    `- ${reviewRoundOf(workflow)} of ${MAX_REVIEW_ROUNDS} review rounds have ended in this workflow. The mod counts one each time a \`workflow:review\` run ends; the loop stops at ${MAX_REVIEW_ROUNDS}.`,
    `- Fixes run in \`workflow:build\`, on ${describeChoice(workflow.models.build)}: spawn it in the foreground with the findings to fix and wait for its report. In this phase it fixes them test-first without the slice lock, then runs every check.`,
    ...(workflow.technical
      ? []
      : [
          '- Technical decisions are off: in step 4, do not ask which minor findings to fix. Have the ones you recommend fixed, write the others under `## Known issues` in `design.md` for the pull request body, and tell the user in one line which were fixed.',
        ]),
  ].join('\n')
}

const ADDED_FILES = '`git diff --name-only --diff-filter=A <base>...HEAD` (the base branch this branch started from) and `git ls-files --others --exclude-standard`'

function removal(workflow: Workflow, specs: string): string {
  const tracked = 'Use `git rm` for a tracked file and `rm` for an untracked one.'
  switch (workflow.keepDocs) {
    case 'all':
      return 'Documents: this workflow keeps them all. Remove no document.'
    case 'specs':
      return `Remove this workflow's documents: \`${specs}/\` and the ADRs this branch added in \`docs/adr/\` (\`git diff --name-only --diff-filter=A <base>...HEAD -- docs/adr/\`, and any untracked one). ${tracked} Every other file stays, other documentation included.`
    case 'code':
      return `Remove every non-code file this branch added, so only the code remains: list them with ${ADDED_FILES}. That takes \`${specs}/\`, the ADRs in \`docs/adr/\`, any other new documentation, and \`.claude/workflow.json\`, the project \`CLAUDE.md\` and \`.claude/settings.json\` when this branch added them. ${tracked} A file that already existed on the base branch and was only edited stays: name those to the user, and never revert them. Keep a file the code needs (a fixture, a config it reads) and say so.`
    case 'ask':
      return `List the non-code files this branch added (${ADDED_FILES}): \`${specs}/\`, the ADRs, other documentation, and the setup files when this branch added them. Ask the user which to keep in one AskUserQuestion with \`multiSelect\`, one option per file or folder, then remove the others. ${tracked} Files that existed on the base branch and were only edited are not in the list: never revert them.`
  }
}

function closing(context: Context, workflow: Workflow): string | undefined {
  if (workflow.phase !== pipelineOf(context, workflow).at(-1)) return undefined
  const specs = specsFolder(context, workflow)
  return [
    '## Closing the workflow',
    '',
    'This is the last phase. Once its other steps are done, close the workflow in this order instead of pushing earlier, then approve:',
    '',
    `1. **Draft the pull request** with \`following-git-conventions\`: title, What, Test, and Known issues from the \`## Known issues\` section of \`${specs}/design.md\` when it has any. Read it now: the next step may remove it. Do not push yet.`,
    `2. **Remove documents.** ${removal(workflow, specs)}`,
    `3. **Ask what to publish** in one AskUserQuestion, always asked whatever the settings, your recommended option first: "${PUBLISH.all}", "${PUBLISH.push}", "${PUBLISH.commit}", "${PUBLISH.nothing}". Leave out the parts already done: the commit when \`git status --porcelain\` is empty, the push when the branch has an upstream with nothing to push, the pull request when \`gh pr view\` finds one. Show the draft with the question.`,
    `4. **Publish what they chose:** commit what is uncommitted, the document removal included, with \`following-git-conventions\`; push with \`git push -u origin ${workflow.branch}\`; open the pull request with \`gh pr create\` and the draft, and give the user its link.`,
    '5. **Approve.** Call `mcp__workflow__advance` with `produced` (what was published: the commit, the push, the pull request and its link) and `open` (anything left for the user). The mod then offers to remove the worktree and the local branch, only when nothing is uncommitted and the branch is pushed.',
  ].join('\n')
}

// Review findings in inspect, and a check that fails in the workflow's worktree after a lane merged: both are fixed
// test-first without the slice lock.
type Fixing = 'review' | 'integration'

const FIXING_INTRO: Readonly<Record<Fixing, string[]>> = {
  review: [
    '## Fixing review findings',
    '',
    'The workflow is in its inspect phase: your prompt names review findings to fix, not a slice. Leave out the lock and verify steps above: mcp__workflow__lock and mcp__workflow__verify belong to the build phase and are refused here, so the discipline is yours.',
    '',
    '1. For each finding, write the failing test that shows it first (a bug found in review gets its failing test before its fix), run it and read the failure: it must fail for the reason the finding names.',
  ],
  integration: [
    '## Fixing the integration',
    '',
    "Your prompt names checks that fail in the workflow's worktree after the mod merged a slice, not a slice to build. You work in that worktree, without a lane: leave out the lock and verify steps above, since mcp__workflow__lock and mcp__workflow__verify belong to the lanes and are refused here, so the discipline is yours. The tests the merged slices locked stay as written: when one of them has to change, stop and put it in your open questions, and the conversation asks the user with mcp__workflow__unlock here; the mod refuses the next merge while a locked line is gone without that unlock.",
    '',
    '1. For each failure, find the failing test that shows it, or write one first when the failure is not a test (a behaviour two slices broke together), run it and read the failure: it must fail for the reason the check named.',
  ],
}

function fixing(config: Config | undefined, kind: Fixing): string {
  return [
    ...FIXING_INTRO[kind],
    '2. Fix it with the smallest change, and run the test again.',
    `3. Run every check, exactly as written, with nothing appended, until each passes: ${greenChecks(config)}.`,
    '4. Report each finding with the test that covers it, and each check with its result. An existing test changes only with a reason the user agrees with: stop and put it in your open questions.',
    ...(kind === 'integration' ? ['5. Commit the fix on the workflow branch, following the following-git-conventions skill: the next merge needs a clean worktree.'] : []),
  ].join('\n')
}

export function integrationFix(config: Config | undefined): string {
  return fixing(config, 'integration')
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
    '- Anything the user needs to read to answer a question goes inside the AskUserQuestion dialog itself, in the question text or in an option\'s `preview` (markdown, one line per point), never only in the text before the dialog: the dialog hides that text.',
    '- End every turn with a line starting "Next:" that says what happens next and whether the user has to act. When the user has to type a command, the Next: line names it.',
  ].join('\n')
}

function defaultModels(context: Context, workflow: Workflow): string {
  return [
    '## Default models',
    '',
    "Each later step of this workflow runs in its own agent. The mod's default model and effort for each:",
    '',
    ...stepsOf(workflow, context.config === undefined).map(step => `- ${step}: ${describeChoice(DEFAULT_PLAN[step])}`),
    ...(workflow.technical
      ? []
      : [
          '',
          'Technical decisions are off, so the user is not asked to choose the models: at the gate the mod uses your recommendations, or these defaults when you give none, and its answer says which, for you to tell the user in one line.',
        ]),
  ].join('\n')
}

function resumeAt(doc: PhaseDoc, workflow: Workflow): string | undefined {
  const name = workflow.step === undefined ? undefined : doc.steps[workflow.step - 1]
  if (name === undefined) return undefined
  return [
    '## Where to resume',
    '',
    `The workflow stopped in this phase at step ${workflow.step} of ${doc.steps.length}: ${name}. Resume there: the steps before it are done, so check their results in this workflow's documents and the handoff below instead of doing them again, and call mcp__workflow__progress with ${workflow.step} as you start it.`,
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
  const inLanes = isBuilding && (await buildsInLanes($, context.paths, workflow))
  return joined([
    ...header(workflow),
    leading(context, workflow),
    workflow.phase === 'done' ? undefined : whatToAsk($, workflow),
    drift,
    resumeAt(doc, workflow),
    doc.body,
    workflow.phase === 'intake' ? defaultModels(context, workflow) : undefined,
    mapAgent(workflow),
    inLanes ? await buildLanes($, context, workflow) : agentPart(workflow, step),
    reviewRounds(workflow),
    closing(context, workflow),
    standing(workflow),
    files($, specsFolder(context, workflow)),
    isBuilding && !inLanes ? await sliceNamed($, context, workflow) : undefined,
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
    whatTheUserIsAsked($, workflow),
    isFixing ? fixing(context.config, 'review') : undefined,
    files($, specsFolder(context, workflow)),
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
