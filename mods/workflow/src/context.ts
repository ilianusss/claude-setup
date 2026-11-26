import type { EngineInterface } from 'claude-code'

import { parseConfig } from './config'
import type { Config } from './config'
import { findRepo } from './repo'
import type { Repo } from './repo'
import { parseSlices } from './slices'
import type { Slice } from './slices'
import { listWorkflows, pathsFor } from './store'
import type { Paths } from './store'
import { pipeline } from './state'
import type { Lane, Phase, Workflow } from './state'

export type Context = {
  repo: Repo
  paths: Paths
  workflows: Workflow[]
  current: Workflow | undefined
  lane: Lane | undefined
  config: Config | undefined
  configErrors: string[]
}

export const DEFAULT_SPECS_DIR = 'docs/specs'

export function isOpen(workflow: Workflow): boolean {
  return workflow.status === 'active' || workflow.status === 'paused'
}

export async function loadContext($: EngineInterface): Promise<Context | undefined> {
  return contextAt($, await $.session.cwd())
}

// The context of a checkout other than the session's: the workflow's worktree, where the mod merges a lane.
export async function contextAt($: EngineInterface, folder: string): Promise<Context | undefined> {
  const repo = await findRepo($, folder)
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
  const { current, lane } = placeOf(workflows, repo.branch)
  return { repo, paths, workflows, current, lane, config, configErrors }
}

// A lane's branch belongs to the workflow it builds a slice of: in a lane, that workflow is current.
function placeOf(workflows: readonly Workflow[], branch: string): Pick<Context, 'current' | 'lane'> {
  const open = workflows.filter(isOpen)
  const current = open.find(workflow => workflow.branch === branch)
  if (current !== undefined) return { current, lane: undefined }
  for (const workflow of open) {
    const lane = workflow.lanes.find(candidate => candidate.branch === branch)
    if (lane !== undefined) return { current: workflow, lane }
  }
  return { current: undefined, lane: undefined }
}

export function pipelineOf(context: Context, workflow: Workflow): Phase[] {
  return pipeline(workflow.size, context.config === undefined || workflow.phase === 'setup')
}

export function specsFolder(context: Context, workflow: Workflow): string {
  return `${context.config?.specsDir ?? DEFAULT_SPECS_DIR}/${workflow.slug}`
}

// In a lane, the documents are read from the workflow's worktree: the lane branched before later slices were ticked.
function documentsRoot(context: Context, workflow: Workflow): string {
  return context.lane === undefined ? context.repo.root : workflow.worktree
}

function slicesPath(context: Context, workflow: Workflow): string {
  return `${documentsRoot(context, workflow)}/${specsFolder(context, workflow)}/slices.md`
}

export async function readSlices($: EngineInterface, context: Context, workflow: Workflow): Promise<Slice[]> {
  try {
    return parseSlices(await $.fs.read(slicesPath(context, workflow)))
  } catch {
    return []
  }
}

export async function readDoc($: EngineInterface, context: Context, workflow: Workflow, name: string): Promise<string | undefined> {
  try {
    return await $.fs.read(`${documentsRoot(context, workflow)}/${specsFolder(context, workflow)}/${name}`)
  } catch {
    return undefined
  }
}
