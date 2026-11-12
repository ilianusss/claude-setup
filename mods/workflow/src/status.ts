import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { WorkflowActivity, WorkflowBanner } from '../types'
import { isOpen, loadContext, pipelineOf, readSlices } from './context'
import type { Context } from './context'
import { age } from './drift'
import { PRODUCES } from './labels'
import { readPhase, stepOf } from './phases'
import { describeChoice } from './plan'
import { readLock } from './store'
import { MAX_REVIEW_ROUNDS, reviewRoundOf } from './state'
import type { Workflow } from './state'

const banner = atom({ plugin: 'workflow', key: 'banner' } as const, null, { shape: 'banner-1' })
const activity = atom({ plugin: 'workflow', key: 'activity' } as const, 'waiting', { shape: 'activity-1' })
const verified = atom({ plugin: 'workflow', key: 'verified' } as const, null, { shape: 'verified-1' })

export const ACTIVITY_TEXT: Readonly<Record<WorkflowActivity, string>> = { working: 'working', waiting: 'waiting for you' }

export function phaseText(view: WorkflowBanner): string {
  return view.slice === null ? view.phase : `${view.phase} ${view.slice.number}/${view.slice.count}`
}

export function statusText(view: WorkflowBanner, now: WorkflowActivity): string {
  return `workflow ${view.slug}: ${phaseText(view)}, ${view.runner}, ${ACTIVITY_TEXT[now]}`
}

export function currentBanner($: EngineInterface): Promise<WorkflowBanner | null> {
  return read($, banner)
}

export function currentActivity($: EngineInterface): Promise<WorkflowActivity> {
  return read($, activity)
}

export async function setActivity($: EngineInterface, now: WorkflowActivity): Promise<void> {
  await update($, activity, () => now)
  const view = await read($, banner)
  if (view !== null) $.ui.status(statusText(view, now))
}

export async function whileWaiting<T>($: EngineInterface, asking: () => Promise<T>): Promise<T> {
  const before = await read($, activity)
  await setActivity($, 'waiting')
  try {
    return await asking()
  } finally {
    await setActivity($, before)
  }
}

export async function markVerified($: EngineInterface, workflow: Workflow, slice: number): Promise<void> {
  await update($, verified, () => ({ slug: workflow.slug, slice }))
}

export async function clearVerified($: EngineInterface): Promise<void> {
  if ((await read($, verified)) === null) return
  await update($, verified, () => null)
  await refreshStatus($)
}

export async function turnEnded($: EngineInterface): Promise<void> {
  await setActivity($, 'waiting')
  await clearVerified($)
}

export async function phaseLabel($: EngineInterface, context: Context, workflow: Workflow): Promise<string> {
  if (workflow.phase !== 'build') return workflow.phase
  return `build ${workflow.slice}/${(await readSlices($, context, workflow)).length}`
}

async function buildStep($: EngineInterface, context: Context, workflow: Workflow): Promise<string> {
  try {
    const lock = await readLock($, context.paths, workflow.slug)
    if (lock?.phase === 'green' && lock.slice === workflow.slice) return 'tests locked'
  } catch {
    return 'lock changed outside the mod'
  }
  const done = await read($, verified)
  return done?.slug === workflow.slug ? `slice ${done.slice} verified` : 'writing tests'
}

async function subStep($: EngineInterface, context: Context, workflow: Workflow): Promise<WorkflowBanner['step']> {
  if (workflow.phase === 'build') return { name: await buildStep($, context, workflow) }
  if (workflow.phase === 'inspect') return { name: reviewStep(workflow) }
  if (workflow.step === undefined || workflow.phase === 'done') return null
  const steps = (await readPhase($, workflow.phase)).steps
  const name = steps[workflow.step - 1]
  return name === undefined ? null : { name, number: workflow.step, count: steps.length }
}

function reviewStep(workflow: Workflow): string {
  const round = reviewRoundOf(workflow)
  return round === 0 ? 'review' : `review round ${round}/${MAX_REVIEW_ROUNDS}`
}

function runnerOf(workflow: Workflow): string {
  const step = stepOf(workflow.phase)
  return step === undefined ? 'conversation' : describeChoice(workflow.models[step])
}

async function bannerOf($: EngineInterface, context: Context, workflow: Workflow): Promise<WorkflowBanner> {
  const isBuilding = workflow.phase === 'build'
  return {
    slug: workflow.slug,
    phases: pipelineOf(context, workflow),
    phase: workflow.phase,
    slice: isBuilding ? { number: workflow.slice, count: (await readSlices($, context, workflow)).length } : null,
    step: await subStep($, context, workflow),
    runner: runnerOf(workflow),
  }
}

export async function refreshStatus($: EngineInterface, given?: Context): Promise<void> {
  const context = given ?? (await loadContext($))
  const current = context?.current
  if (context === undefined || current === undefined) {
    await update($, banner, () => null)
    $.ui.status(undefined)
    return
  }
  const view = await bannerOf($, context, current)
  await update($, banner, () => view)
  $.ui.status(statusText(view, await read($, activity)))
}

export function announcePhase($: EngineInterface, workflow: Workflow): void {
  if (workflow.phase === 'done') return
  $.ui.log(`workflow ${workflow.slug}: the ${workflow.phase} phase starts. It produces ${PRODUCES[workflow.phase]}.`)
}

export async function announce($: EngineInterface, context: Context, now: number): Promise<void> {
  const open = context.workflows.filter(isOpen)
  if (open.length === 0) return
  const listed = open.map(workflow => `${workflow.slug} (${workflow.phase}, ${age(workflow.updated, now)})`).join(', ')
  $.ui.toast(`workflow: open here: ${listed}. /workflow continue resumes one.`)
}
