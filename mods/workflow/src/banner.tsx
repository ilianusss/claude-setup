import type { EngineInterface, On, RenderInput, TextProps } from 'claude-code'

import type { WorkflowActivity, WorkflowBanner } from '../types'
import { describe } from './refusal'
import { ACTIVITY_TEXT, currentActivity, currentBanner, phaseText, setActivity } from './status'

export type StepState = 'done' | 'current' | 'next'
export type StepSegment = { label: string; state: StepState }
export type BandLeft = { head: string; detail: string; runner: string; activity: string }
export type BandLine = { left: BandLeft; steps: StepSegment[] }

const STEP_GAP = '  '
const DIVIDER = '│'
const SECTION_GAP = ' '
const PART_GAP = ' · '
const ELLIPSIS = '...'
const SHORTEST_STEP = 12
const FRAME_WIDTH = 4
// The terminal's hint row under the prompt keeps two columns before it and three after, as the skin plugin's usage band measures it.
const HINT_INSET = 5
const UNMEASURED_COLUMNS = 80

const STEP_LOOK: Readonly<Record<StepState, TextProps>> = {
  done: { color: 'success' },
  current: { weight: 'bold', color: 'suggestion' },
  next: { color: 'inactive' },
}
const STEP_MARK: Readonly<Record<StepState, string>> = { done: '✓ ', current: '● ', next: '' }

function stepText(segment: StepSegment): string {
  return segment.label === ELLIPSIS ? ELLIPSIS : `${STEP_MARK[segment.state]}${segment.label}`
}

function rightWidth(steps: readonly StepSegment[]): number {
  return steps.length === 0 ? DIVIDER.length : DIVIDER.length + SECTION_GAP.length + steps.map(stepText).join(STEP_GAP).length
}

function leftWidth(left: BandLeft): number {
  const runner = left.runner === '' ? 0 : PART_GAP.length + left.runner.length
  return left.head.length + left.detail.length + runner + PART_GAP.length + left.activity.length
}

function stateOf(index: number, current: number): StepState {
  if (index < current) return 'done'
  return index === current ? 'current' : 'next'
}

function windowOf(all: readonly StepSegment[], first: number, last: number): StepSegment[] {
  return [
    ...(first > 0 ? [{ label: ELLIPSIS, state: 'done' as const }] : []),
    ...all.slice(first, last + 1),
    ...(last < all.length - 1 ? [{ label: ELLIPSIS, state: 'next' as const }] : []),
  ]
}

// Widest first: the steps before the current one go, then those after it, then the whole list, since the sub-step
// names the current step too.
function stepChoices(view: WorkflowBanner): StepSegment[][] {
  const current = view.phases.indexOf(view.phase)
  const all = view.phases.map((phase, index) => ({ label: phase, state: stateOf(index, current) }))
  if (current === -1) return [all, []]
  const end = all.length - 1
  const windows: Array<[number, number]> = []
  for (let first = 0; first <= current; first += 1) windows.push([first, end])
  for (let last = end - 1; last > current; last -= 1) windows.push([current, last])
  return [...windows.filter(([first, last]) => last > first).map(([first, last]) => windowOf(all, first, last)), []]
}

function headText(view: WorkflowBanner): string {
  const step = view.step
  const position = step?.number === undefined || step.count === undefined ? '' : ` ${step.number}/${step.count}`
  return `${phaseText(view)}${position}`
}

function detailText(view: WorkflowBanner): string {
  return view.step === null ? '' : `: ${view.step.name}`
}

function shortened(text: string, room: number): string {
  return text.length <= room ? text : `${text.slice(0, Math.max(room - ELLIPSIS.length, 0))}${ELLIPSIS}`
}

// Drops steps until the line fits, then shortens the sub-step and drops the model, so whether the workflow waits for
// the user always shows. The divider stays, so the two sections stay apart.
export function bandLine(view: WorkflowBanner, now: WorkflowActivity, columns: number): BandLine {
  const head = headText(view)
  const detail = detailText(view)
  const activity = ACTIVITY_TEXT[now]
  const left = { head, detail, runner: view.runner, activity }
  const steps = stepChoices(view).find(choice => leftWidth(left) + SECTION_GAP.length + rightWidth(choice) <= columns)
  if (steps !== undefined) return { left, steps }
  const room = columns - rightWidth([]) - SECTION_GAP.length - activity.length
  const runner = room - (PART_GAP.length * 2 + view.runner.length) >= SHORTEST_STEP ? view.runner : ''
  const tail = runner === '' ? PART_GAP.length : PART_GAP.length * 2 + runner.length
  const text = shortened(`${head}${detail}`, room - tail)
  return { left: { head: text.slice(0, head.length), detail: text.slice(head.length), runner, activity }, steps: [] }
}

function bandRow($: EngineInterface, e: RenderInput<'PromptHint' | 'AbovePrompt'>, line: BandLine, now: WorkflowActivity, width?: number) {
  const { Box, Text } = $.ui.resolve(e)
  const { left, steps } = line
  const segments = steps.flatMap((segment, index) => [...(index > 0 ? [STEP_GAP] : []), <Text {...STEP_LOOK[segment.state]}>{stepText(segment)}</Text>])
  return (
    <Box borderStyle="round" borderColor="subtle" paddingX={1} justifyContent="space-between" {...(width === undefined ? {} : { width })}>
      <Text wrap="truncate-end">
        <Text weight="bold" color="claude">{left.head}</Text>
        <Text color="text">{left.detail}</Text>
        {left.runner === '' ? [] : [<Text color="subtle">{PART_GAP}</Text>, <Text color="permission">{left.runner}</Text>]}
        <Text color="subtle">{PART_GAP}</Text>
        <Text color={now === 'waiting' ? 'warning' : 'planMode'}>{left.activity}</Text>
      </Text>
      <Text>
        <Text color="subtle">{DIVIDER}</Text>
        {segments.length === 0 ? [] : [SECTION_GAP, ...segments]}
      </Text>
    </Box>
  )
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

  // On the terminal the band is a bordered row under the prompt, beside the skin plugin's usage band: the hint line
  // and what other mods drew there stay above it.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const theirs = await next(e)
    if (e.surface !== 'terminal') return theirs
    const view = await currentBanner($)
    if (view === null) return theirs
    const now = await currentActivity($)
    const width = (e.viewport?.columns ?? UNMEASURED_COLUMNS) - HINT_INSET
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {theirs}
        {bandRow($, e, bandLine(view, now, width - FRAME_WIDTH), now, width)}
      </Box>
    )
  })

  // Elsewhere the band stays above the prompt, as the skin plugin's usage band does on the desktop: the engine's types
  // say no surface but the terminal draws an addition to the hint line yet.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'terminal' || e.props.hasSurvey) return next(e)
    const view = await currentBanner($)
    if (view === null) return next(e)
    const now = await currentActivity($)
    return bandRow($, e, bandLine(view, now, e.props.bodyColumns - FRAME_WIDTH), now)
  })
}
