import type { EngineInterface } from 'claude-code'

import { sha256 } from './hash'
import { parseLock, renderLock } from './lock'
import type { Lock, Run } from './lock'
import type { Repo } from './repo'
import { parseWorkflow, renderWorkflow } from './state'
import type { Phase, Status, Workflow } from './state'

export type Paths = { dir: string; locks: string; runs: string; treeIndex: string }

type IndexEntry = { root: string; slug: string; title: string; phase: Phase; status: Status; updated: string }

const INDEX_KEY = 'index'
const KEPT_RUNS = 30

export function pathsFor(repo: Repo): Paths {
  const dir = `${repo.commonDir}/claude-workflow`
  return { dir, locks: `${dir}/locks`, runs: `${dir}/runs`, treeIndex: `${dir}/tree-index` }
}

export async function listWorkflows($: EngineInterface, paths: Paths): Promise<Workflow[]> {
  let entries: Awaited<ReturnType<EngineInterface['fs']['list']>>
  try {
    entries = await $.fs.list(paths.dir)
  } catch {
    return []
  }
  const workflows: Workflow[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
    try {
      workflows.push(parseWorkflow(await $.fs.read(`${paths.dir}/${entry.name}`)))
    } catch (error) {
      $.ui.log(`workflow: ${entry.name} is not a valid state file and is skipped: ${String(error)}`, { to: 'debug' })
    }
  }
  return workflows.sort((a, b) => b.updated.localeCompare(a.updated))
}

async function readIndex($: EngineInterface): Promise<Record<string, IndexEntry>> {
  const stored = await $.store.get(INDEX_KEY)
  return typeof stored === 'object' && stored !== null ? (stored as Record<string, IndexEntry>) : {}
}

export async function openWorkflowsEverywhere($: EngineInterface): Promise<IndexEntry[]> {
  return Object.values(await readIndex($)).sort((a, b) => b.updated.localeCompare(a.updated))
}

export async function saveWorkflow($: EngineInterface, repo: Repo, paths: Paths, workflow: Workflow): Promise<void> {
  await $.fs.write(`${paths.dir}/${workflow.slug}.md`, renderWorkflow(workflow))
  const index = await readIndex($)
  const key = `${repo.root}#${workflow.slug}`
  if (workflow.status === 'done' || workflow.status === 'abandoned') delete index[key]
  else {
    const { slug, title, phase, status, updated } = workflow
    index[key] = { root: repo.root, slug, title, phase, status, updated }
  }
  await $.store.set(INDEX_KEY, index)
}

function lockPath(paths: Paths, slug: string): string {
  return `${paths.locks}/${slug}.json`
}

export async function readLock($: EngineInterface, paths: Paths, slug: string): Promise<Lock | undefined> {
  const path = lockPath(paths, slug)
  let text: string
  try {
    text = await $.fs.read(path)
  } catch {
    return undefined
  }
  const fingerprint = await $.store.get(`lock:${path}`)
  if (fingerprint !== (await sha256(text))) {
    throw new Error(
      `the lock of "${slug}" changed outside the workflow mod (${path}). Nothing was unlocked: ask the user to check it, and to delete it if they want to lock the slice again.`,
    )
  }
  return parseLock(text)
}

export async function saveLock($: EngineInterface, paths: Paths, lock: Lock): Promise<void> {
  const path = lockPath(paths, lock.slug)
  const text = renderLock(lock)
  await $.fs.write(path, text)
  await $.store.set(`lock:${path}`, await sha256(text))
}

export async function readRuns($: EngineInterface, paths: Paths, slug: string): Promise<Run[]> {
  try {
    const runs: unknown = JSON.parse(await $.fs.read(`${paths.runs}/${slug}.json`))
    return Array.isArray(runs) ? (runs as Run[]) : []
  } catch {
    return []
  }
}

export async function addRun($: EngineInterface, paths: Paths, slug: string, run: Run): Promise<void> {
  const runs = [...(await readRuns($, paths, slug)), run].slice(-KEPT_RUNS)
  await $.fs.write(`${paths.runs}/${slug}.json`, `${JSON.stringify(runs, null, 2)}\n`)
}
