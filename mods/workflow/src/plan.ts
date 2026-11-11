export const STEPS = ['map', 'setup', 'spec', 'design', 'slice', 'build', 'review'] as const
export type Step = (typeof STEPS)[number]

export const MODELS = ['haiku', 'sonnet', 'opus'] as const
export type Model = (typeof MODELS)[number]

export const EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const
export type Effort = (typeof EFFORTS)[number]

export type ModelChoice = { model: Model; effort: Effort }
export type ModelPlan = Readonly<Record<Step, ModelChoice>>

export const DEFAULT_PLAN: ModelPlan = {
  map: { model: 'sonnet', effort: 'medium' },
  setup: { model: 'sonnet', effort: 'medium' },
  spec: { model: 'opus', effort: 'high' },
  design: { model: 'opus', effort: 'high' },
  slice: { model: 'opus', effort: 'high' },
  build: { model: 'opus', effort: 'medium' },
  review: { model: 'opus', effort: 'high' },
}

export function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.find(candidate => candidate === value)
}

export function parsePlan(entries: readonly string[]): ModelPlan {
  const plan: Record<Step, ModelChoice> = { ...DEFAULT_PLAN }
  for (const entry of entries) {
    const [stepName, modelName, effortName, ...rest] = entry.trim().split(/\s+/)
    const step = oneOf(stepName, STEPS)
    const model = oneOf(modelName, MODELS)
    const effort = oneOf(effortName, EFFORTS)
    if (step !== undefined && model !== undefined && effort !== undefined && rest.length === 0) plan[step] = { model, effort }
  }
  return plan
}

export function renderPlan(plan: ModelPlan): string[] {
  return STEPS.map(step => `${step} ${plan[step].model} ${plan[step].effort}`)
}

export type Recommendation = ModelChoice & { step: Step; reason: string }

const REASON_LENGTH = 200

// The choices a dialog offers one step down or up from the recommended one, cheapest first.
const LADDER: readonly ModelChoice[] = [
  { model: 'haiku', effort: 'low' },
  { model: 'haiku', effort: 'medium' },
  { model: 'sonnet', effort: 'low' },
  { model: 'sonnet', effort: 'medium' },
  { model: 'sonnet', effort: 'high' },
  { model: 'opus', effort: 'medium' },
  { model: 'opus', effort: 'high' },
  { model: 'opus', effort: 'xhigh' },
]

export function describeChoice(choice: ModelChoice): string {
  return `${choice.model} ${choice.effort}`
}

export function isSameChoice(a: ModelChoice, b: ModelChoice): boolean {
  return a.model === b.model && a.effort === b.effort
}

export function parseChoice(text: string): ModelChoice | undefined {
  const [modelName, effortName, ...rest] = text.trim().toLowerCase().split(/\s+/)
  const model = oneOf(modelName, MODELS)
  const effort = oneOf(effortName, EFFORTS)
  return model !== undefined && effort !== undefined && rest.length === 0 ? { model, effort } : undefined
}

function field(entry: Record<string, unknown>, key: string): string {
  const value = entry[key]
  return typeof value === 'string' ? value : String(value)
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > REASON_LENGTH ? `${line.slice(0, REASON_LENGTH - 3)}...` : line
}

function parseRecommendation(entry: unknown, steps: readonly Step[], seen: Set<Step>): Recommendation | string {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return `${JSON.stringify(entry)} is not a { step, model, effort, reason } entry`
  const record = entry as Record<string, unknown>
  const named = `"${field(record, 'step')} ${field(record, 'model')} ${field(record, 'effort')}"`
  const step = oneOf(typeof record.step === 'string' ? record.step : undefined, STEPS)
  const model = oneOf(typeof record.model === 'string' ? record.model : undefined, MODELS)
  const effort = oneOf(typeof record.effort === 'string' ? record.effort : undefined, EFFORTS)
  const reason = typeof record.reason === 'string' ? oneLine(record.reason) : ''
  if (step === undefined || !steps.includes(step)) return `${named}: the step must be one of this workflow's: ${steps.join(', ')}`
  if (model === undefined) return `${named}: the model must be ${MODELS.join(', ')}`
  if (effort === undefined) return `${named}: the effort must be ${EFFORTS.join(', ')}`
  if (effort === 'xhigh' && reason.length === 0) return `${named}: xhigh needs a reason`
  if (seen.has(step)) return `${named}: ${step} has two recommendations`
  seen.add(step)
  return { step, model, effort, reason }
}

export function parseRecommendations(input: unknown, steps: readonly Step[]): { recommendations: Recommendation[] } | { errors: string[] } {
  if (!Array.isArray(input)) return { errors: ['recommendations must be a list of { step, model, effort, reason } entries'] }
  const seen = new Set<Step>()
  const parsed = input.map(entry => parseRecommendation(entry, steps, seen))
  const errors = parsed.filter((entry): entry is string => typeof entry === 'string')
  return errors.length > 0 ? { errors } : { recommendations: parsed.filter((entry): entry is Recommendation => typeof entry !== 'string') }
}

export function withRecommendations(plan: ModelPlan, recommendations: readonly Recommendation[]): ModelPlan {
  const changed: Record<Step, ModelChoice> = { ...plan }
  for (const { step, model, effort } of recommendations) changed[step] = { model, effort }
  return changed
}

function cost(choice: ModelChoice): number {
  return MODELS.indexOf(choice.model) * EFFORTS.length + EFFORTS.indexOf(choice.effort)
}

export function cheaper(choice: ModelChoice): ModelChoice | undefined {
  return LADDER.filter(candidate => cost(candidate) < cost(choice)).at(-1)
}

export function stronger(choice: ModelChoice): ModelChoice | undefined {
  return LADDER.find(candidate => cost(candidate) > cost(choice))
}
