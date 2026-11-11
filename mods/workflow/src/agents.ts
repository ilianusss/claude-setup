import type { AgentSpec, EngineInterface } from 'claude-code'

import { loadContext } from './context'
import type { Context } from './context'
import type { ModelChoice, Step } from './plan'
import { agentInstructions } from './prompts'
import { describe } from './refusal'

export const WITHHELD_TOOLS = ['mcp__workflow__advance', 'mcp__workflow__handoff', 'AskUserQuestion'] as const

const WORKER_RULES = [
  '## How you work',
  '',
  "- The user's conversation spawned you and reads your report; you cannot ask the user anything, and only the conversation moves the workflow to its next phase.",
  '- When a decision belongs to the user (a test that looks wrong, a criterion that contradicts the design, a missing fact), stop and put it in your open questions, with the evidence.',
  '- Do the work these instructions name and nothing else.',
  '',
  '## Report',
  '',
  'End your run with this report, and nothing after it:',
  '',
  '- Done: what you did, in a few lines.',
  '- Files: every file you wrote or changed.',
  '- Checks: each command you ran for the checks and its result, and the answers of mcp__workflow__lock and mcp__workflow__verify.',
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
  }
}

export async function registerAgents($: EngineInterface, given?: Context): Promise<void> {
  try {
    const context = given ?? (await loadContext($))
    const workflow = context?.current
    if (context === undefined || workflow === undefined || workflow.phase !== 'build') return
    const instructions = await agentInstructions($, context, workflow)
    if (instructions === undefined) return
    await $.agent.register(buildAgentSpec('build', workflow.models.build, instructions))
  } catch (error) {
    $.ui.log(`workflow: workflow:build could not be registered: ${describe(error)}`, { to: 'debug' })
  }
}
