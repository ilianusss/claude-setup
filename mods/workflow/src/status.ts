import type { EngineInterface } from 'claude-code'

import { isOpen, loadContext, readSlices } from './context'
import type { Context } from './context'
import { age } from './drift'
import { readLock } from './store'
import type { Workflow } from './state'

export async function phaseLabel($: EngineInterface, context: Context, workflow: Workflow): Promise<string> {
  if (workflow.phase !== 'build') return workflow.phase
  return `build ${workflow.slice}/${(await readSlices($, context, workflow)).length}`
}

export async function refreshStatus($: EngineInterface, given?: Context): Promise<void> {
  const context = given ?? (await loadContext($))
  const current = context?.current
  if (context === undefined || current === undefined) {
    $.ui.status(undefined)
    return
  }
  let locked = ''
  try {
    locked = (await readLock($, context.paths, current.slug))?.phase === 'green' ? ', tests locked' : ''
  } catch {
    locked = ', lock changed outside the mod'
  }
  $.ui.status(`workflow ${current.slug}: ${await phaseLabel($, context, current)}${locked}`)
}

export async function announce($: EngineInterface, context: Context, now: number): Promise<void> {
  const open = context.workflows.filter(isOpen)
  if (open.length === 0) return
  const listed = open.map(workflow => `${workflow.slug} (${workflow.phase}, ${age(workflow.updated, now)})`).join(', ')
  $.ui.toast(`workflow: open here: ${listed}. /workflow continue resumes one.`)
}
