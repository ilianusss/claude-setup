import { GATE } from './labels'
import { refuse } from './refusal'
import type { Phase } from './state'

const SECTIONS = ['produced', 'decisions', 'risks', 'open'] as const
const POINTS = ['problem', 'result', 'success', 'limits', 'outOfScope'] as const

export type PhaseSummary = Readonly<Record<(typeof SECTIONS)[number], readonly string[]>>
export type IntakeSummary = Readonly<Record<(typeof POINTS)[number], string>>
export type GateSummary = { kind: 'phase'; sections: PhaseSummary } | { kind: 'intake'; points: IntakeSummary }

function items(input: Record<string, unknown>, key: (typeof SECTIONS)[number]): string[] {
  const value = input[key]
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    refuse(`${key} must be a list of short lines, one item each, and it is not: nothing moved. Call mcp__workflow__advance again with ${key} as a list.`)
  }
  return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(item => item.length > 0)
}

function onOneLine(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function givenOf(input: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter(key => input[key] !== undefined)
}

function parseIntake(input: Record<string, unknown>): IntakeSummary {
  const wrong = givenOf(input, SECTIONS)
  if (wrong.length > 0) {
    refuse(
      `${wrong.join(', ')} belong to the gates of the other phases, and the intake gate takes ${POINTS.join(', ')}: nothing moved. Call mcp__workflow__advance again with the five points.`,
    )
  }
  const points = {
    problem: onOneLine(input.problem),
    result: onOneLine(input.result),
    success: onOneLine(input.success),
    limits: onOneLine(input.limits),
    outOfScope: onOneLine(input.outOfScope),
  }
  const missing = POINTS.filter(point => points[point] === '')
  if (missing.length > 0) {
    refuse(
      `the intake gate needs all five points as non-empty text ("not stated" is a valid value), and ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing or empty: nothing moved. Call mcp__workflow__advance again with the five points.`,
    )
  }
  return points
}

function parsePhase(phase: Phase, slug: string, input: Record<string, unknown>): PhaseSummary {
  const wrong = givenOf(input, POINTS)
  if (wrong.length > 0) {
    refuse(
      `${wrong.join(', ')} belong to the intake gate only, and "${slug}" is in its ${phase} phase: nothing moved. Call mcp__workflow__advance again with produced, and decisions, risks and open when there are any.`,
    )
  }
  const sections = { produced: items(input, 'produced'), decisions: items(input, 'decisions'), risks: items(input, 'risks'), open: items(input, 'open') }
  if (sections.produced.length === 0) {
    refuse(`the ${phase} gate needs produced, at least one line on what this phase produced, and it has none: nothing moved. Call mcp__workflow__advance again with it.`)
  }
  return sections
}

export function parseGateSummary(phase: Phase, slug: string, input: Record<string, unknown>): GateSummary {
  return phase === 'intake' ? { kind: 'intake', points: parseIntake(input) } : { kind: 'phase', sections: parsePhase(phase, slug, input) }
}

function pointLines(points: IntakeSummary): string {
  return POINTS.map(point => `${GATE.points[point]} ${points[point]}`).join('\n')
}

function sectionLines(sections: PhaseSummary): string {
  return SECTIONS.filter(section => sections[section].length > 0)
    .map(section => [GATE.sections[section], ...sections[section].map(item => `- ${item}`)].join('\n'))
    .join('\n\n')
}

export function gateQuestion(summary: GateSummary, phase: Phase, slug: string, target: Phase): string {
  const body = summary.kind === 'intake' ? pointLines(summary.points) : sectionLines(summary.sections)
  return `${GATE.question(phase, slug, target)}\n\n${body}`
}

export function goalOf(summary: GateSummary): string | undefined {
  return summary.kind === 'intake' ? pointLines(summary.points) : undefined
}
