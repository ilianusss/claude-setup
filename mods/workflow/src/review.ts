import type { EngineInterface, TurnCompleteInput } from 'claude-code'

import { day, iso } from './clock'
import { loadContext } from './context'
import { describe } from './refusal'
import { MAX_REVIEW_ROUNDS, reviewRoundOf, withLog } from './state'
import { refreshStatus } from './status'
import { saveWorkflow } from './store'

const REVIEW_AGENT = 'workflow:review'

type AgentRunEnd = Pick<TurnCompleteInput, 'reason'> & { agentId: string }

async function isReviewRun($: EngineInterface, agentId: string): Promise<boolean> {
  return (await $.agent.list()).find(agent => agent.id === agentId)?.type === REVIEW_AGENT
}

// The mod counts the rounds rather than trusting the conversation's count: only the state file survives a pause.
export async function endReviewRound($: EngineInterface, ended: AgentRunEnd): Promise<void> {
  try {
    if (ended.reason !== 'answer') return
    const context = await loadContext($)
    const workflow = context?.current
    if (context === undefined || workflow?.phase !== 'inspect') return
    if (!(await isReviewRun($, ended.agentId))) return
    const round = reviewRoundOf(workflow) + 1
    const now = await $.clock.now()
    await saveWorkflow($, context.repo, context.paths, withLog({ ...workflow, reviewRound: round, updated: iso(now) }, day(now), `review round ${round}`))
    $.ui.log(`workflow ${workflow.slug}: review round ${round} of ${MAX_REVIEW_ROUNDS} ended.`)
    await refreshStatus($)
  } catch (error) {
    $.ui.log(`workflow: the review round could not be counted: ${describe(error)}`, { to: 'debug' })
  }
}
