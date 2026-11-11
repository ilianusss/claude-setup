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

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
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
