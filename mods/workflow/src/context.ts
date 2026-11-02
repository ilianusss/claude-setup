import type { EngineInterface } from 'claude-code'

import { parseConfig } from './config'
import type { Config } from './config'
import { findRepo } from './repo'
import type { Repo } from './repo'
import { parseSlices } from './slices'
import type { Slice } from './slices'
import { listWorkflows, pathsFor } from './store'
import type { Paths } from './store'
import type { Workflow } from './state'

export type Context = {
  repo: Repo
  paths: Paths
  workflows: Workflow[]
  current: Workflow | undefined
  config: Config | undefined
  configErrors: string[]
}

export const DEFAULT_SPECS_DIR = 'docs/specs'

export function isOpen(workflow: Workflow): boolean {
  return workflow.status === 'active' || workflow.status === 'paused'
}

export async function loadContext($: EngineInterface): Promise<Context | undefined> {
  const repo = await findRepo($, await $.session.cwd())
  if (repo === undefined) return undefined
  const paths = pathsFor(repo)
  const workflows = await listWorkflows($, paths)
  let config: Config | undefined
  let configErrors: string[] = []
  try {
    const parsed = parseConfig(await $.fs.read(`${repo.root}/.claude/workflow.json`))
    if ('config' in parsed) config = parsed.config
    else configErrors = parsed.errors
  } catch {
    configErrors = []
  }
  const current = workflows.find(workflow => isOpen(workflow) && workflow.branch === repo.branch)
  return { repo, paths, workflows, current, config, configErrors }
}

export function specsFolder(context: Context, workflow: Workflow): string {
  return `${context.config?.specsDir ?? DEFAULT_SPECS_DIR}/${workflow.slug}`
}

export async function readSlices($: EngineInterface, context: Context, workflow: Workflow): Promise<Slice[]> {
  try {
    return parseSlices(await $.fs.read(`${context.repo.root}/${specsFolder(context, workflow)}/slices.md`))
  } catch {
    return []
  }
}

export async function readDoc($: EngineInterface, context: Context, workflow: Workflow, name: string): Promise<string | undefined> {
  try {
    return await $.fs.read(`${context.repo.root}/${specsFolder(context, workflow)}/${name}`)
  } catch {
    return undefined
  }
}
