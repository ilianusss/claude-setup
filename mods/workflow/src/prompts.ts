import type { EngineInterface } from 'claude-code'

import { readDoc, readSlices, specsFolder } from './context'
import type { Context } from './context'
import { readPhase } from './phases'
import { sections } from './slices'
import type { Workflow } from './state'

function bulletOr(items: readonly string[], none: string): string {
  return items.length > 0 ? items.join('; ') : none
}

function standing(workflow: Workflow): string {
  return [
    '## Where the workflow stands',
    '',
    `- Goal: ${workflow.goal || '(not written yet)'}`,
    `- Where we stopped: ${workflow.stopped || '(nothing yet)'}`,
    `- Next action: ${workflow.next || '(decide it from the phase instructions)'}`,
    `- Open questions: ${bulletOr(workflow.questions, 'none')}`,
    `- Documents: ${bulletOr(workflow.docs, 'none yet')}`,
  ].join('\n')
}

function files($: EngineInterface, specs: string): string {
  return [
    '## Files',
    '',
    `- This workflow's documents: \`${specs}/\``,
    `- Guides the phase names: \`${$.plugin.root}/guides/\``,
    `- Templates: \`${$.plugin.root}/templates/\``,
  ].join('\n')
}

async function currentSlice($: EngineInterface, context: Context, workflow: Workflow): Promise<string> {
  const slices = await readSlices($, context, workflow)
  const slice = slices.find(candidate => candidate.number === workflow.slice)
  if (slice === undefined) {
    return `## Slice ${workflow.slice}\n\n\`slices.md\` has no slice ${workflow.slice}. Tell the user, and stop.`
  }
  const design = (await readDoc($, context, workflow, 'design.md')) ?? ''
  const needed = sections(design, slice.designSections)
  return [
    `## This slice (${slice.number} of ${slices.length})`,
    '',
    slice.text,
    '',
    '## Design sections it needs',
    '',
    needed.length > 0 ? needed : '(the slice names none)',
  ].join('\n')
}

export async function phasePrompt(
  $: EngineInterface,
  context: Context,
  workflow: Workflow,
  drift?: string,
): Promise<string> {
  const doc = await readPhase($, workflow.phase)
  const specs = specsFolder(context, workflow)
  const slice = workflow.phase === 'build' ? `, slice ${workflow.slice}` : ''
  const parts = [
    `# Workflow: ${workflow.title}`,
    `You are working on the workflow \`${workflow.slug}\` (${workflow.size}), phase ${workflow.phase}${slice}, on branch \`${workflow.branch}\`. The workflow mod keeps its state: change it only through the mcp__workflow__* tools. Commits after each slice: ${workflow.commits ? 'yes' : 'no, the user commits'}.`,
    drift,
    doc.body,
    standing(workflow),
    files($, specs),
    workflow.phase === 'build' ? await currentSlice($, context, workflow) : undefined,
  ]
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join('\n\n')
}

export async function setupPrompt($: EngineInterface): Promise<string> {
  const doc = await readPhase($, 'setup')
  return [
    '# Workflow setup',
    'This project has no `.claude/workflow.json` yet. Set it up so workflows can run here.',
    doc.body,
    `Templates: \`${$.plugin.root}/templates/\``,
  ].join('\n\n')
}

export function pausePrompt(workflow: Workflow): string {
  return `Pause the workflow \`${workflow.slug}\`: call mcp__workflow__handoff now with where you stopped, the next concrete action and any open questions. Then stop and tell the user it is paused and how to resume (\`/workflow continue ${workflow.slug}\`).`
}
