import type { EngineInterface, On } from 'claude-code'

import type { WorkflowActivity, WorkflowBanner } from '../types'
import { describe } from './refusal'
import { ACTIVITY_TEXT, currentActivity, currentBanner, phaseText, setActivity } from './status'

export type StepSegment = { label: string; isCurrent: boolean }
export type DetailLine = { lead: string; activity: string }

const STEP_GAP = '  '
const PART_GAP = ' · '
const ELLIPSIS = '...'
const SHORTEST_STEP = 12

function widthOf(segments: readonly StepSegment[]): number {
  return segments.map(segment => segment.label).join(STEP_GAP).length
}

// Drops the steps before the current one until the line fits, so a narrow terminal still shows where the workflow is.
export function stepSegments(view: WorkflowBanner, columns: number): StepSegment[] {
  const all = view.phases.map(phase => ({ label: phase === view.phase ? phaseText(view) : phase, isCurrent: phase === view.phase }))
  const current = Math.max(all.findIndex(segment => segment.isCurrent), 0)
  let shown = all
  for (let first = 1; first <= current && widthOf(shown) > columns; first += 1) {
    shown = [{ label: ELLIPSIS, isCurrent: false }, ...all.slice(first)]
  }
  return shown
}

function subStepText(view: WorkflowBanner): string {
  const step = view.step
  if (step === null) return phaseText(view)
  const position = step.number === undefined || step.count === undefined ? '' : ` ${step.number}/${step.count}`
  return `${phaseText(view)}${position}: ${step.name}`
}

function shortened(text: string, room: number): string {
  return text.length <= room ? text : `${text.slice(0, Math.max(room - ELLIPSIS.length, 0))}${ELLIPSIS}`
}

// Shortens the sub-step first and drops the model next, so whether the workflow waits for the user always shows.
export function detailLine(view: WorkflowBanner, now: WorkflowActivity, columns: number): DetailLine {
  const shown = ACTIVITY_TEXT[now]
  const step = subStepText(view)
  const withRunner = `${PART_GAP}${view.runner}${PART_GAP}`
  if (step.length + withRunner.length + shown.length <= columns) return { lead: `${step}${withRunner}`, activity: shown }
  const tail = columns - withRunner.length - shown.length >= SHORTEST_STEP ? withRunner : PART_GAP
  return { lead: `${shortened(step, columns - tail.length - shown.length)}${tail}`, activity: shown }
}

// The band is a display and this hook runs in every session: a failed update is logged, and the prompt goes on.
function logActivityFailure($: EngineInterface, error: unknown): void {
  $.ui.log(`workflow: the band's activity could not be updated: ${describe(error)}`, { to: 'debug' })
}

async function markWorking($: EngineInterface): Promise<WorkflowActivity | undefined> {
  try {
    const before = await currentActivity($)
    await setActivity($, 'working')
    return before
  } catch (error) {
    logActivityFailure($, error)
    return undefined
  }
}

async function restoreActivity($: EngineInterface, before: WorkflowActivity): Promise<void> {
  try {
    await setActivity($, before)
  } catch (error) {
    logActivityFailure($, error)
  }
}

export function registerBanner(on: On): void {
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined) return next(e)
    const before = await markWorking($)
    const submitted = await next(e)
    if (submitted.drop !== undefined && before !== undefined) await restoreActivity($, before)
    return submitted
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const view = await currentBanner($)
    if (view === null) return next(e)
    const now = await currentActivity($)
    const columns = e.props.bodyColumns
    const { Box, Text } = $.ui.resolve(e)
    const steps = stepSegments(view, columns).flatMap((segment, index) => [
      ...(index > 0 ? [STEP_GAP] : []),
      segment.isCurrent ? (
        <Text weight="bold" color="suggestion">
          {segment.label}
        </Text>
      ) : (
        <Text dimColor>{segment.label}</Text>
      ),
    ])
    const detail = detailLine(view, now, columns)
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">{steps}</Text>
        <Text wrap="truncate-end">
          <Text dimColor>{detail.lead}</Text>
          {now === 'waiting' ? <Text color="warning">{detail.activity}</Text> : <Text dimColor>{detail.activity}</Text>}
        </Text>
      </Box>
    )
  })
}
