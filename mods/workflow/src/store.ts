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

const queues = new Map<string, Promise<unknown>>()

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
  const index = await readIndex($)
  const gone = []
  for (const [key, entry] of Object.entries(index)) if (!(await $.fs.exists(entry.root))) gone.push(key)
  if (gone.length > 0) {
    for (const key of gone) delete index[key]
    await $.store.set(INDEX_KEY, index)
  }
  return Object.values(index).sort((a, b) => b.updated.localeCompare(a.updated))
}

// The index keys a workflow by its worktree, whichever checkout saved it: a lane saves the state too.
export async function saveWorkflow($: EngineInterface, paths: Paths, workflow: Workflow): Promise<void> {
  await $.fs.write(`${paths.dir}/${workflow.slug}.md`, renderWorkflow(workflow))
  const index = await readIndex($)
  const key = `${workflow.worktree}#${workflow.slug}`
  if (workflow.status === 'done' || workflow.status === 'abandoned') delete index[key]
  else {
    const { slug, title, phase, status, updated } = workflow
    index[key] = { root: workflow.worktree, slug, title, phase, status, updated }
  }
  await $.store.set(INDEX_KEY, index)
}

export async function readWorkflow($: EngineInterface, paths: Paths, slug: string): Promise<Workflow> {
  return parseWorkflow(await $.fs.read(`${paths.dir}/${slug}.md`))
}

function oneAtATime<T>(key: string, work: () => Promise<T>): Promise<T> {
  const done = (queues.get(key) ?? Promise.resolve()).then(work)
  queues.set(
    key,
    done.catch(() => undefined),
  )
  return done
}

// Parallel lanes lock and verify at the same time, and two read-modify-writes of one state file would drop one change:
// the updates of a workflow run one after the other, each on the state the last one saved.
export function updateWorkflow(
  $: EngineInterface,
  paths: Paths,
  slug: string,
  change: (workflow: Workflow) => Workflow,
): Promise<Workflow> {
  return oneAtATime(`state:${paths.dir}/${slug}`, async () => {
    const workflow = change(await readWorkflow($, paths, slug))
    await saveWorkflow($, paths, workflow)
    return workflow
  })
}

// Work on a workflow's branch and files that must not interleave with another of its kind, such as two lane merges:
// one would read slices.md or the lock before the other saved them. It updates the state through updateWorkflow, whose
// queue is apart from this one.
export function withWorkflow<T>(paths: Paths, slug: string, work: () => Promise<T>): Promise<T> {
  return oneAtATime(`work:${paths.dir}/${slug}`, work)
}

// A lane has its own lock, runs and tree index, so lanes building at the same time never share one: two `git add -A`
// on one index file race. They live under `lanes/`, a folder no slug names, so no workflow's own file is a lane's.
export function laneKey(slug: string, slice: number): string {
  if (!isPlainSlug(slug)) throw new Error(`"${slug}" is not a plain file name`)
  if (!Number.isInteger(slice) || slice < 1) throw new Error(`slice ${slice} is not a positive whole number`)
  return `lanes/${slug}/${slice}`
}

// The workflow lock as it stood when the lane was made, which the lane's worktree holds: its first lock starts from it.
export function seedKey(slug: string, slice: number): string {
  return `${laneKey(slug, slice)}.seed`
}

// Where a lane merges the versions of a locked test: a folder of its own, so lanes never share the files.
export function mergeFolderOf(paths: Paths, key: string): string {
  return `${paths.dir}/merge-file/${key}`
}

export function treeIndexOf(paths: Paths, key: string | undefined): string {
  return key === undefined ? paths.treeIndex : `${paths.dir}/${key}.index`
}

function lockPath(paths: Paths, key: string): string {
  return `${paths.locks}/${key}.json`
}

function laneFiles(paths: Paths, key: string): string[] {
  return [lockPath(paths, key), lockPath(paths, `${key}.seed`), `${paths.runs}/${key}.json`, treeIndexOf(paths, key)]
}

// The slug names the files rm deletes: a separator or a leading dot would reach outside the state folder.
const PLAIN_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function isPlainSlug(slug: string): boolean {
  return PLAIN_SLUG.test(slug)
}

async function removeFiles($: EngineInterface, slug: string, files: readonly string[]): Promise<void> {
  if (!isPlainSlug(slug)) throw new Error(`"${slug}" is not a plain file name`)
  const removed = await $.process.run(['rm', '-f', '--', ...files])
  if (removed.exitCode !== 0) throw new Error(`rm could not delete the files of "${slug}": ${removed.stderr.trim()}`)
}

export async function deleteLaneFiles($: EngineInterface, paths: Paths, slug: string, slice: number): Promise<void> {
  const key = laneKey(slug, slice)
  await removeFiles($, slug, laneFiles(paths, key))
  for (const locked of [key, `${key}.seed`]) await $.store.delete(`lock:${lockPath(paths, locked)}`)
}

// The index keys a workflow by the checkout that saved it, its worktree or the main checkout: `roots` names them all.
export async function deleteWorkflow(
  $: EngineInterface,
  paths: Paths,
  workflow: Pick<Workflow, 'slug' | 'lanes'>,
  roots: readonly string[],
): Promise<void> {
  const { slug } = workflow
  const lanes = workflow.lanes.map(lane => laneKey(slug, lane.slice))
  await removeFiles($, slug, [`${paths.dir}/${slug}.md`, lockPath(paths, slug), `${paths.runs}/${slug}.json`, ...lanes.flatMap(key => laneFiles(paths, key))])
  for (const key of [slug, ...lanes, ...lanes.map(lane => `${lane}.seed`)]) await $.store.delete(`lock:${lockPath(paths, key)}`)
  const index = await readIndex($)
  for (const [key, entry] of Object.entries(index)) if (entry.slug === slug && roots.includes(entry.root)) delete index[key]
  await $.store.set(INDEX_KEY, index)
}

// A workflow that commits builds its slices in lanes, once the slice it may have locked in its own worktree before
// lanes existed is verified.
export async function buildsInLanes($: EngineInterface, paths: Paths, workflow: Workflow): Promise<boolean> {
  return workflow.commits && (await readLock($, paths, workflow.slug))?.phase !== 'green'
}

export async function readLock($: EngineInterface, paths: Paths, key: string): Promise<Lock | undefined> {
  const path = lockPath(paths, key)
  let text: string
  try {
    text = await $.fs.read(path)
  } catch {
    return undefined
  }
  const fingerprint = await $.store.get(`lock:${path}`)
  if (fingerprint !== (await sha256(text))) {
    throw new Error(
      `the lock of "${key}" changed outside the workflow mod (${path}). Nothing was unlocked: ask the user to check it, and to delete it if they want to lock the slice again.`,
    )
  }
  return parseLock(text)
}

export async function saveLock($: EngineInterface, paths: Paths, key: string, lock: Lock): Promise<void> {
  const path = lockPath(paths, key)
  const text = renderLock(lock)
  await $.fs.write(path, text)
  await $.store.set(`lock:${path}`, await sha256(text))
}

export async function readRuns($: EngineInterface, paths: Paths, key: string): Promise<Run[]> {
  try {
    const runs: unknown = JSON.parse(await $.fs.read(`${paths.runs}/${key}.json`))
    return Array.isArray(runs) ? (runs as Run[]) : []
  } catch {
    return []
  }
}

export async function addRun($: EngineInterface, paths: Paths, key: string, run: Run): Promise<void> {
  const runs = [...(await readRuns($, paths, key)), run].slice(-KEPT_RUNS)
  await $.fs.write(`${paths.runs}/${key}.json`, `${JSON.stringify(runs, null, 2)}\n`)
}
