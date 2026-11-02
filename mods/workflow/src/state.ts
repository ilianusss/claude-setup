import { parseFrontmatter, renderFrontmatter } from './frontmatter'
import type { Frontmatter } from './frontmatter'

export const PHASES = ['setup', 'spec', 'design', 'slice', 'build', 'inspect', 'retro', 'done'] as const
export type Phase = (typeof PHASES)[number]
export type Size = 'feature' | 'project'
export type Status = 'active' | 'paused' | 'done' | 'abandoned'

const SIZES: readonly Size[] = ['feature', 'project']
const STATUSES: readonly Status[] = ['active', 'paused', 'done', 'abandoned']
const SEQUENCES: Readonly<Record<Size, readonly Phase[]>> = {
  feature: ['design', 'slice', 'build', 'inspect', 'done'],
  project: ['spec', 'design', 'slice', 'build', 'inspect', 'retro', 'done'],
}
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
  commits: boolean
  autoNext: boolean
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
  return {
    slug: text(data, 'slug'),
    title: text(data, 'title'),
    size: oneOf(data, 'size', SIZES),
    phase: oneOf(data, 'phase', PHASES),
    status: oneOf(data, 'status', STATUSES),
    branch: text(data, 'branch'),
    worktree: text(data, 'worktree'),
    slice,
    commits: flag(data, 'commits'),
    autoNext: flag(data, 'auto_next'),
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
    commits: workflow.commits ? 'yes' : 'no',
    auto_next: workflow.autoNext ? 'yes' : 'no',
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

export function phaseAfter(size: Size, phase: Phase): Phase {
  const sequence = SEQUENCES[size]
  if (phase === 'setup') return sequence[0] ?? 'done'
  const index = sequence.indexOf(phase)
  return index < 0 ? 'done' : (sequence[index + 1] ?? 'done')
}

export function firstPhase(size: Size, needsSetup: boolean): Phase {
  return needsSetup ? 'setup' : (SEQUENCES[size][0] ?? 'done')
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

export function withLog(workflow: Workflow, date: string, entry: string): Workflow {
  return { ...workflow, log: [...workflow.log, `${date} ${entry}`].slice(-LOG_LENGTH) }
}
