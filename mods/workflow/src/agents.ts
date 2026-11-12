import type { AgentSpec, EngineInterface } from 'claude-code'

import { loadContext } from './context'
import type { Context } from './context'
import { withoutFrontmatter } from './frontmatter'
import type { ModelChoice, Step } from './plan'
import { stepsOf } from './phases'
import { agentInstructions } from './prompts'
import { describe } from './refusal'
import type { Workflow } from './state'

export const WITHHELD_TOOLS = ['mcp__workflow__advance', 'mcp__workflow__handoff', 'mcp__workflow__unlock', 'AskUserQuestion'] as const
export const REVIEW_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'] as const

const REVIEWER_FALLBACK =
  'You review a change you did not write, in a context that never saw the conversation that wrote it. Read the diff and the code around it, run only read-only commands, and never edit a file. Report each finding with its severity (blocker, major or minor), its file and line, the rule it breaks, the evidence and a direction for the fix.'

const WORKER_RULES = [
  '## How you work',
  '',
  "- The user's conversation spawned you and reads your report; you cannot ask the user anything, and only the conversation moves the workflow to its next phase.",
  '- When a decision belongs to the user (a test that looks wrong, a criterion that contradicts the design, a choice between options, a missing fact), stop and put it in your open questions, with the evidence.',
  '- Do the work these instructions name and nothing else.',
  '',
  '## Report',
  '',
  'End your run with this report, and nothing after it:',
  '',
  '- Done: what you did, in a few lines, or your findings when you review.',
  '- Files: every file you wrote or changed.',
  '- Checks: each command you ran for the checks and its result, and the answers of mcp__workflow__lock and mcp__workflow__verify when you called them.',
  '- Open questions: what the user has to decide, with the evidence, or "none".',
].join('\n')

export function buildAgentSpec(step: Step, choice: ModelChoice, instructions: string): AgentSpec {
  return {
    name: step,
    description: `Does the ${step} work of the workflow on this branch. Spawn it only when the workflow's phase prompt says so, and relay its report to the user.`,
    prompt: `${instructions}\n\n${WORKER_RULES}`,
    model: choice.model,
    effort: choice.effort,
    disallowedTools: WITHHELD_TOOLS,
    ...(step === 'review' ? { tools: REVIEW_TOOLS } : {}),
  }
}

function inRegistrationOrder(steps: readonly Step[]): Step[] {
  return [...steps.filter(step => step !== 'build'), ...steps.filter(step => step === 'build')]
}

async function reviewerPrompt($: EngineInterface): Promise<string> {
  const setupRoot = $.plugin.root.split('/').slice(0, -2).join('/')
  try {
    return withoutFrontmatter(await $.fs.read(`${setupRoot}/agents/reviewer.md`))
  } catch (error) {
    $.ui.log(`workflow: agents/reviewer.md could not be read, workflow:review uses its own prompt: ${describe(error)}`, { to: 'debug' })
    return REVIEWER_FALLBACK
  }
}

async function registerStep($: EngineInterface, context: Context, workflow: Workflow, step: Step): Promise<void> {
  try {
    const instructions = await agentInstructions($, context, workflow, step)
    if (instructions === undefined) return
    const prompt = step === 'review' ? `${await reviewerPrompt($)}\n\n${instructions}` : instructions
    await $.agent.register(buildAgentSpec(step, workflow.models[step], prompt))
  } catch (error) {
    $.ui.log(`workflow: workflow:${step} could not be registered: ${describe(error)}`, { to: 'debug' })
  }
}

// An agent type registered in a turn is spawned from the next turn on: whoever registers them hands the work that
// spawns them to a turn of its own.
export async function registerAgentsFor($: EngineInterface, context: Context, workflow: Workflow): Promise<void> {
  try {
    for (const step of inRegistrationOrder(stepsOf(workflow, context.config === undefined))) {
      await registerStep($, context, workflow, step)
    }
  } catch (error) {
    $.ui.log(`workflow: the step agents could not be registered: ${describe(error)}`, { to: 'debug' })
  }
}

export async function registerAgents($: EngineInterface, given?: Context): Promise<void> {
  try {
    const context = given ?? (await loadContext($))
    const workflow = context?.current
    if (context === undefined || workflow === undefined) return
    await registerAgentsFor($, context, workflow)
  } catch (error) {
    $.ui.log(`workflow: the step agents could not be registered: ${describe(error)}`, { to: 'debug' })
  }
}
