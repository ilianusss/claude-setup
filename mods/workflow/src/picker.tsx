import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { WorkflowPicker } from '../types'
import { registerAgents } from './agents'
import { askOrUndefined } from './ask'
import { day, iso, submitLater } from './clock'
import { loadContext } from './context'
import type { Context } from './context'
import { PICKER } from './labels'
import { stepsOf } from './phases'
import {
  DEFAULT_PLAN,
  EFFORTS,
  MODELS,
  STEPS,
  cheaper,
  describeChoice,
  isSameChoice,
  oneOf,
  parseChoice,
  parsePlan,
  parseRecommendations,
  renderPlan,
  stronger,
  withRecommendations,
} from './plan'
import type { ModelChoice, ModelPlan, Recommendation, Step } from './plan'
import { phasePrompt } from './prompts'
import { describe } from './refusal'
import { withLog } from './state'
import type { Workflow } from './state'
import { setActivity } from './status'
import { saveWorkflow } from './store'

export const PICKER_PANE = 'workflow-models'

const picker = atom({ plugin: 'workflow', key: 'picker' } as const, null, { shape: 'picker-1' })
const remembered = atom({ plugin: 'workflow', key: 'recommendations' } as const, {}, { shape: 'recommendations-1' })

const WIDE_COLUMNS = 80
const STEP_WIDTH = 9
const SELECT_WIDTH = 24
const XHIGH_WARNING = "xhigh is for hard problems that high could not solve: it spends the plan's limits fastest."

type Row = { step: Step; choice: ModelChoice; fallback: ModelChoice; recommendation: Recommendation | undefined }
type StepOption = { label: string; choice: ModelChoice }

function shownSteps(state: WorkflowPicker): Step[] {
  return STEPS.filter(step => state.steps.includes(step))
}

function recommendationsIn(state: WorkflowPicker): Recommendation[] {
  const parsed = parseRecommendations(state.recommendations, shownSteps(state))
  return 'errors' in parsed ? [] : parsed.recommendations
}

function rowsOf(state: WorkflowPicker): Row[] {
  const plan = parsePlan(state.plan)
  const recommendations = recommendationsIn(state)
  return shownSteps(state).map(step => ({
    step,
    choice: plan[step],
    fallback: DEFAULT_PLAN[step],
    recommendation: recommendations.find(recommendation => recommendation.step === step),
  }))
}

function recommendedOf(row: Row): ModelChoice {
  return row.recommendation ?? row.fallback
}

export function withPick(state: WorkflowPicker, step: Step, field: 'model' | 'effort', value: string): WorkflowPicker {
  if (!shownSteps(state).includes(step)) return state
  const plan = parsePlan(state.plan)
  const model = field === 'model' ? oneOf(value, MODELS) : plan[step].model
  const effort = field === 'effort' ? oneOf(value, EFFORTS) : plan[step].effort
  if (model === undefined || effort === undefined) return state
  return { ...state, plan: renderPlan({ ...plan, [step]: { model, effort } }) }
}

function resetToRecommended(state: WorkflowPicker): WorkflowPicker {
  const recommended = withRecommendations(DEFAULT_PLAN, recommendationsIn(state))
  const plan: Record<Step, ModelChoice> = { ...parsePlan(state.plan) }
  for (const step of shownSteps(state)) plan[step] = recommended[step]
  return { ...state, plan: renderPlan(plan) }
}

export async function savePlan($: EngineInterface, context: Context, workflow: Workflow, plan: ModelPlan, now: number): Promise<Workflow> {
  const changed = STEPS.filter(step => !isSameChoice(workflow.models[step], plan[step]))
  if (changed.length === 0) return workflow
  const entry = `models changed: ${changed.map(step => `${step} ${describeChoice(plan[step])}`).join(', ')}`
  const saved = withLog({ ...workflow, models: plan, updated: iso(now) }, day(now), entry)
  await saveWorkflow($, context.repo, context.paths, saved)
  return saved
}

export async function rememberRecommendations($: EngineInterface, slug: string, recommendations: readonly Recommendation[]): Promise<void> {
  await update($, remembered, kept => ({ ...kept, [slug]: [...recommendations] }))
}

export async function recommendationsFor($: EngineInterface, slug: string): Promise<Recommendation[]> {
  const parsed = parseRecommendations((await read($, remembered))[slug] ?? [], STEPS)
  return 'errors' in parsed ? [] : parsed.recommendations
}

function optionOf(choice: ModelChoice | undefined, suffix = ''): StepOption | undefined {
  return choice === undefined ? undefined : { label: `${describeChoice(choice)}${suffix}`, choice }
}

function stepOptions(recommended: ModelChoice, fallback: ModelChoice): StepOption[] {
  const candidates = [
    optionOf(recommended, ` ${PICKER.dialogRecommended}`),
    optionOf(fallback, ` ${PICKER.dialogDefault}`),
    optionOf(cheaper(recommended)),
    optionOf(stronger(recommended)),
  ].filter((option): option is StepOption => option !== undefined)
  return candidates.filter((option, index) => candidates.findIndex(other => isSameChoice(other.choice, option.choice)) === index)
}

async function askStep($: EngineInterface, workflow: Workflow, step: Step, recommendation: Recommendation | undefined): Promise<ModelChoice | undefined> {
  const options = stepOptions(recommendation ?? DEFAULT_PLAN[step], DEFAULT_PLAN[step])
  const why = recommendation === undefined ? '' : `Claude recommends ${describeChoice(recommendation)}${recommendation.reason ? `: ${recommendation.reason}` : ''}. `
  const question = `${why}Now: ${describeChoice(workflow.models[step])}. Which model and effort should the ${step} step of "${workflow.slug}" use?`
  let asked = question
  for (;;) {
    const answer = await askOrUndefined($, asked, options.map(option => option.label), step)
    if (answer === undefined) return undefined
    const choice = options.find(option => option.label === answer)?.choice ?? parseChoice(answer)
    if (choice !== undefined) return choice
    asked = `"${answer.slice(0, 40)}" is not a model and an effort (${MODELS.join(', ')}, then ${EFFORTS.join(', ')}). ${question}`
  }
}

async function askPerStep(
  $: EngineInterface,
  workflow: Workflow,
  steps: readonly Step[],
  recommendations: readonly Recommendation[],
): Promise<ModelPlan | undefined> {
  const plan: Record<Step, ModelChoice> = { ...workflow.models }
  for (const step of steps) {
    const choice = await askStep($, workflow, step, recommendations.find(recommendation => recommendation.step === step))
    if (choice === undefined) return undefined
    plan[step] = choice
  }
  return plan
}

async function openPane($: EngineInterface, steps: readonly Step[]): Promise<boolean> {
  try {
    const opened = await $.ui.open({ id: PICKER_PANE, title: PICKER.title, focus: true, closeOnEscape: true, holdToasts: true, rows: 10 + 3 * steps.length })
    if (opened.isPlaced) {
      await setActivity($, 'waiting')
      return true
    }
    $.ui.log(`workflow: the Models panel is not shown (${opened.reason}): each step is asked in a dialog instead.`, { to: 'debug' })
  } catch (error) {
    $.ui.log(`workflow: the Models panel could not open (${describe(error)}): each step is asked in a dialog instead.`, { to: 'debug' })
  }
  return false
}

export async function chooseModels(
  $: EngineInterface,
  context: Context,
  workflow: Workflow,
  recommendations: readonly Recommendation[],
  then: WorkflowPicker['then'],
): Promise<Workflow | 'pane'> {
  const steps = stepsOf(workflow, context.config === undefined)
  const preselected = then === 'phase' ? withRecommendations(DEFAULT_PLAN, recommendations) : workflow.models
  await update($, picker, () => ({ slug: workflow.slug, steps, plan: renderPlan(preselected), recommendations: [...recommendations], then }))
  if (await openPane($, steps)) return 'pane'
  await update($, picker, () => null)
  await $.ui.close({ id: PICKER_PANE })
  const plan = await askPerStep($, workflow, steps, recommendations)
  return plan === undefined ? workflow : savePlan($, context, workflow, plan, await $.clock.now())
}

async function takePicker($: EngineInterface): Promise<WorkflowPicker | null> {
  let taken: WorkflowPicker | null = null
  await update($, picker, current => {
    taken = current
    return null
  })
  return taken
}

async function finishPicker($: EngineInterface, outcome: 'use' | 'cancel'): Promise<void> {
  const state = await takePicker($)
  if (state === null) return
  try {
    const context = await loadContext($)
    const workflow = context?.workflows.find(candidate => candidate.slug === state.slug)
    if (context === undefined || workflow === undefined) return
    const saved = outcome === 'use' ? await savePlan($, context, workflow, parsePlan(state.plan), await $.clock.now()) : workflow
    if (saved !== workflow) await registerAgents($)
    if (state.then === 'phase') {
      submitLater($, `The user has chosen the models in the Models panel. Go on with the ${saved.phase} phase:\n\n${await phasePrompt($, context, saved)}`)
    } else if (saved !== workflow) {
      $.ui.toast(`Saved the models of "${saved.slug}".`)
    }
  } catch (error) {
    $.ui.toast(`The models of "${state.slug}" could not be saved: ${describe(error)}`)
  }
}

async function closePicker($: EngineInterface, outcome: 'use' | 'cancel'): Promise<void> {
  await finishPicker($, outcome)
  await $.ui.close({ id: PICKER_PANE })
}

function pick($: EngineInterface, step: Step, field: 'model' | 'effort', value: string): Promise<unknown> {
  return update($, picker, current => (current === null ? current : withPick(current, step, field, value)))
}

function reset($: EngineInterface): Promise<unknown> {
  return update($, picker, current => (current === null ? current : resetToRecommended(current)))
}

function modelOptions(row: Row): Array<{ value: string; label: string }> {
  return MODELS.map(model => ({ value: model, label: model === recommendedOf(row).model ? `${model} (${PICKER.recommended})` : model }))
}

function effortOptions(row: Row): Array<{ value: string; label: string }> {
  return EFFORTS.map(effort => ({ value: effort, label: effort === recommendedOf(row).effort ? `${effort} (${PICKER.recommended})` : effort }))
}

function recommendationLine(row: Row): string {
  if (row.recommendation === undefined) return 'No recommendation from Claude for this step.'
  const reason = row.recommendation.reason ? `: ${row.recommendation.reason}` : ''
  return `Claude recommends ${describeChoice(row.recommendation)}${reason}`
}

export function registerPicker(on: On): void {
  on('ui.render', { component: 'Pane', requestId: PICKER_PANE }, async ($, e) => {
    const state = await read($, picker)
    if (e.surface === 'mobile') {
      const { Box, Button, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" gap={1}>
          <Text>The Models panel needs a terminal or the desktop app: choose there with /workflow models.</Text>
          <Box>
            <Button key="cancel" label={PICKER.cancel} role="dismiss" onPress={() => closePicker($, 'cancel')} />
          </Box>
        </Box>
      )
    }
    const { Box, Button, Select, Text } = $.ui.resolve(e)
    if (state === null) return <Text dimColor>No model choice is open: /workflow models opens one.</Text>
    const isWide = e.props.bodyColumns >= WIDE_COLUMNS
    const rows = rowsOf(state).map((row, index) => {
      const isChanged = !isSameChoice(row.choice, row.fallback)
      const selects = (
        <Box flexDirection="row" gap={1}>
          <Box width={SELECT_WIDTH}>
            <Select
              key={`model-${row.step}`}
              options={modelOptions(row)}
              value={row.choice.model}
              autoFocus={index === 0 ? true : undefined}
              onSelect={value => pick($, row.step, 'model', value)}
            />
          </Box>
          <Box width={SELECT_WIDTH}>
            <Select
              key={`effort-${row.step}`}
              options={effortOptions(row)}
              value={row.choice.effort}
              onSelect={value => pick($, row.step, 'effort', value)}
            />
          </Box>
          {isChanged ? <Text color="suggestion">changed from {describeChoice(row.fallback)}</Text> : <Text dimColor>default</Text>}
        </Box>
      )
      return (
        <Box flexDirection="column">
          {isWide ? (
            <Box flexDirection="row" gap={1}>
              <Box width={STEP_WIDTH}>
                <Text weight="bold">{row.step}</Text>
              </Box>
              {selects}
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text weight="bold">{row.step}</Text>
              {selects}
            </Box>
          )}
          <Box paddingLeft={isWide ? STEP_WIDTH + 1 : 0} flexDirection="column">
            <Text dimColor wrap="truncate-end">
              {recommendationLine(row)}
            </Text>
            {row.choice.effort === 'xhigh' && <Text color="warning">{XHIGH_WARNING}</Text>}
          </Box>
        </Box>
      )
    })
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text weight="bold">Models for {state.slug}</Text>
        <Text dimColor>Each step of this workflow runs in its own agent, on the model and effort set here.</Text>
        {isWide && (
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Box width={STEP_WIDTH}>
              <Text dimColor>Step</Text>
            </Box>
            <Box width={SELECT_WIDTH}>
              <Text dimColor>Model</Text>
            </Box>
            <Box width={SELECT_WIDTH}>
              <Text dimColor>Effort</Text>
            </Box>
          </Box>
        )}
        <Box flexDirection="column" gap={1} marginTop={isWide ? 0 : 1}>
          {rows}
        </Box>
        <Box flexDirection="row" gap={2} marginTop={1}>
          <Button key="use" label={PICKER.use} variant="primary" hotkey="u" onPress={() => closePicker($, 'use')} />
          <Button key="reset" label={PICKER.reset} hotkey="r" onPress={() => reset($)} />
          <Button key="cancel" label={PICKER.cancel} role="dismiss" onPress={() => closePicker($, 'cancel')} />
        </Box>
        <Text dimColor>Tab moves, Enter picks, u uses these, r resets, Esc cancels.</Text>
      </Box>
    )
  })

  on('ui.close', { id: PICKER_PANE }, async ($, e, next) => {
    const closed = await next(e)
    await finishPicker($, 'cancel')
    return closed
  })
}
