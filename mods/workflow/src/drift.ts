import type { EngineInterface } from 'claude-code'

import type { Context } from './context'
import { defaultBranch, git, lines } from './repo'
import type { Workflow } from './state'

export const DAY_MS = 86_400_000
const DRIFT_AFTER_DAYS = 14
const SHOWN_COMMITS = '20'
const LOCKFILES = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'Cargo.lock',
  'go.sum',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
  'Gemfile.lock',
  'composer.lock',
]

export function daysSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / DAY_MS))
}

export function age(iso: string, now: number): string {
  const days = daysSince(iso, now)
  if (days === 0) return 'today'
  return days === 1 ? '1 day ago' : `${days} days ago`
}

export async function driftFacts(
  $: EngineInterface,
  context: Context,
  workflow: Workflow,
  now: number,
): Promise<string | undefined> {
  const days = daysSince(workflow.updated, now)
  const base = await defaultBranch($, context.repo)
  const counted = base === undefined ? undefined : await git($, context.repo.root, ['rev-list', '--count', `HEAD..${base}`])
  const behind = counted?.exitCode === 0 ? Number(counted.stdout.trim()) || 0 : 0
  if (days <= DRIFT_AFTER_DAYS && behind === 0) return undefined

  const facts = ['## Drift since this workflow was last touched', '', `- Last update: ${days} days ago.`]
  if (base !== undefined) {
    facts.push(`- This branch is ${behind} commits behind ${base}.`)
    const scope = workflow.paths.length > 0 ? ['--', ...workflow.paths] : []
    const log = await git($, context.repo.root, ['log', '--oneline', '-n', SHOWN_COMMITS, `--since=${workflow.updated}`, base, ...scope])
    const commits = log.exitCode === 0 ? lines(log.stdout) : []
    const where = workflow.paths.length > 0 ? ` in ${workflow.paths.join(', ')}` : ''
    facts.push(commits.length > 0 ? `- Commits on ${base} since then${where}:` : `- No commit on ${base} since then${where}.`)
    facts.push(...commits.map(commit => `  - ${commit}`))
    if (behind > 0) {
      const stat = await git($, context.repo.root, ['diff', '--stat', `HEAD...${base}`, '--', ...LOCKFILES])
      const changed = stat.exitCode === 0 ? lines(stat.stdout) : []
      if (changed.length > 0) facts.push('- Lockfile changes:', ...changed.map(line => `  - ${line}`))
    }
  }
  facts.push(
    '',
    `Before anything else, follow \`${$.plugin.root}/guides/drift-check.md\`: run the project checks once, summarize in at most 10 lines what this means for the next step, and offer a rebase if the branch is behind.`,
  )
  return facts.join('\n')
}
