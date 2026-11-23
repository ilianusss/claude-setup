import { parseFrontmatter, renderFrontmatter } from './frontmatter'
import type { Frontmatter } from './frontmatter'
import { parsePlan, renderPlan } from './plan'
import type { ModelPlan } from './plan'

export const PHASES = ['intake', 'setup', 'spec', 'design', 'slice', 'build', 'inspect', 'retro', 'done'] as const
export type Phase = (typeof PHASES)[number]
export type Size = 'feature' | 'project'
export type Status = 'active' | 'paused' | 'done' | 'abandoned'
export type Prompting = 'all' | 'major'
// Which documents the closing removes: none, the spec folder and ADRs, every non-code file the branch added, or the user picks.
export type KeepDocs = 'all' | 'specs' | 'code' | 'ask'

const SIZES: readonly Size[] = ['feature', 'project']
const STATUSES: readonly Status[] = ['active', 'paused', 'done', 'abandoned']
const PROMPTINGS: readonly Prompting[] = ['all', 'major']
const KEEP_DOCS: readonly KeepDocs[] = ['all', 'specs', 'code', 'ask']
const SEQUENCES: Readonly<Record<Size, readonly Phase[]>> = {
  feature: ['intake', 'design', 'slice', 'build', 'inspect', 'done'],
  project: ['intake', 'spec', 'design', 'slice', 'build', 'inspect', 'retro', 'done'],
}
export const MAX_REVIEW_ROUNDS = 3
const LOG_LENGTH = 10
const SLUG_WORDS = 5

export type Workflow = {
  slug: string
  title: string
  size: Size
  phase: Phase
  status: Status
  branch: string
  worktree: string
  slice: number
  step?: number
  reviewRound?: number
  prompting: Prompting
  technical: boolean
  commits: boolean
  autoNext: boolean
  keepDocs: KeepDocs
  models: ModelPlan
  paths: string[]
  session: string
  updated: string
  goal: string
  docs: string[]
  stopped: string
  next: string
  questions: string[]
  log: string[]
}

function text(data: Frontmatter, key: string): string {
  const value = data[key]
  if (typeof value !== 'string') throw new Error(`${key} is missing or not a single value`)
  return value
}

function oneOf<T extends string>(data: Frontmatter, key: string, allowed: readonly T[]): T {
  const value = text(data, key)
  const found = allowed.find(candidate => candidate === value)
  if (found === undefined) throw new Error(`${key} is "${value}", expected one of ${allowed.join(', ')}`)
  return found
}

function flag(data: Frontmatter, key: string): boolean {
  return oneOf(data, key, ['yes', 'no']) === 'yes'
}

// A workflow saved before these settings existed was asked about everything: it reads as that.
function promptingOf(data: Frontmatter): Prompting {
  return data.prompting === undefined ? 'all' : oneOf(data, 'prompting', PROMPTINGS)
}

function technicalOf(data: Frontmatter): boolean {
  return data.technical === undefined || flag(data, 'technical')
}

// A workflow saved before the documents question existed kept every document.
function keepDocsOf(data: Frontmatter): KeepDocs {
  return data.keep_docs === undefined ? 'all' : oneOf(data, 'keep_docs', KEEP_DOCS)
}

function positive(data: Frontmatter, key: string): number | undefined {
  const value = data[key]
  const count = Number(value)
  return typeof value === 'string' && Number.isInteger(count) && count > 0 ? count : undefined
}

function list(data: Frontmatter, key: string): string[] {
  const value = data[key]
  if (value === undefined) return []
  return typeof value === 'string' ? [value] : [...value]
}

function bodySections(body: string): Map<string, string> {
  const found = new Map<string, string>()
  let heading: string | undefined
  let lines: string[] = []
  const close = () => {
    if (heading !== undefined) found.set(heading, lines.join('\n').trim())
  }
  for (const line of body.split('\n')) {
    if (line.startsWith('## ')) {
      close()
      heading = line.slice(3).trim()
      lines = []
    } else {
      lines.push(line)
    }
  }
  close()
  return found
}

function bullets(section: string | undefined): string[] {
  return (section ?? '')
    .split('\n')
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim())
}

export function parseWorkflow(markdown: string): Workflow {
  const { data, body } = parseFrontmatter(markdown)
  const slice = Number(text(data, 'slice'))
  if (!Number.isInteger(slice) || slice < 0) throw new Error(`slice is "${text(data, 'slice')}", expected a whole number`)
  const sections = bodySections(body)
  const step = positive(data, 'step')
  const reviewRound = positive(data, 'review_round')
  return {
    slug: text(data, 'slug'),
    title: text(data, 'title'),
    size: oneOf(data, 'size', SIZES),
    phase: oneOf(data, 'phase', PHASES),
    status: oneOf(data, 'status', STATUSES),
    branch: text(data, 'branch'),
    worktree: text(data, 'worktree'),
    slice,
    ...(step === undefined ? {} : { step }),
    ...(reviewRound === undefined ? {} : { reviewRound }),
    prompting: promptingOf(data),
    technical: technicalOf(data),
    commits: flag(data, 'commits'),
    autoNext: flag(data, 'auto_next'),
    keepDocs: keepDocsOf(data),
    models: parsePlan(list(data, 'models')),
    paths: list(data, 'paths'),
    session: text(data, 'session'),
    updated: text(data, 'updated'),
    goal: sections.get('Goal') ?? '',
    docs: bullets(sections.get('Docs')),
    stopped: sections.get('Where we stopped') ?? '',
    next: sections.get('Next action') ?? '',
    questions: bullets(sections.get('Open questions')),
    log: bullets(sections.get('Log')),
  }
}

function section(heading: string, content: string): string {
  return content.length > 0 ? `## ${heading}\n\n${content}\n` : `## ${heading}\n`
}

function bulletList(items: readonly string[]): string {
  return items.map(item => `- ${item}`).join('\n')
}

export function renderWorkflow(workflow: Workflow): string {
  const data: Frontmatter = {
    slug: workflow.slug,
    title: workflow.title,
    size: workflow.size,
    phase: workflow.phase,
    status: workflow.status,
    branch: workflow.branch,
    worktree: workflow.worktree,
    slice: String(workflow.slice),
    ...(workflow.step === undefined ? {} : { step: String(workflow.step) }),
    ...(reviewRoundOf(workflow) === 0 ? {} : { review_round: String(workflow.reviewRound) }),
    prompting: workflow.prompting,
    technical: workflow.technical ? 'yes' : 'no',
    commits: workflow.commits ? 'yes' : 'no',
    auto_next: workflow.autoNext ? 'yes' : 'no',
    keep_docs: workflow.keepDocs,
    models: renderPlan(workflow.models),
    paths: workflow.paths,
    session: workflow.session,
    updated: workflow.updated,
  }
  const body = [
    `\n# ${workflow.title}\n`,
    section('Goal', workflow.goal),
    section('Docs', bulletList(workflow.docs)),
    section('Where we stopped', workflow.stopped),
    section('Next action', workflow.next),
    section('Open questions', bulletList(workflow.questions)),
    section('Log', bulletList(workflow.log)),
  ].join('\n')
  return renderFrontmatter(data, body)
}

export function phaseAfter(size: Size, phase: Phase, needsSetup = false): Phase {
  if (phase === 'intake' && needsSetup) return 'setup'
  const sequence = SEQUENCES[size]
  const index = sequence.indexOf(phase === 'setup' ? 'intake' : phase)
  return index < 0 ? 'done' : (sequence[index + 1] ?? 'done')
}

export function pipeline(size: Size, withSetup: boolean): Phase[] {
  const phases = SEQUENCES[size].filter(phase => phase !== 'done')
  return withSetup ? ['intake', 'setup', ...phases.slice(1)] : phases
}

// The saved sub-step and the review rounds belong to the phase they were counted in.
export function inPhase(workflow: Workflow, phase: Phase): Workflow {
  return { ...workflow, phase, step: undefined, reviewRound: undefined }
}

export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(word => word.length > 0)
    .slice(0, SLUG_WORDS)
    .join('-')
}

export function reviewRoundOf(workflow: Workflow): number {
  return workflow.reviewRound ?? 0
}

export function withLog(workflow: Workflow, date: string, entry: string): Workflow {
  return { ...workflow, log: [...workflow.log, `${date} ${entry}`].slice(-LOG_LENGTH) }
}
