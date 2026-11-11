import type { EngineInterface } from 'claude-code'

import { parseFrontmatter } from './frontmatter'
import type { Phase, Workflow } from './state'

export type PhaseDoc = { writes: string[]; body: string; agent: string | undefined }

const AGENT_HEADING = '## Agent'

const loaded = new Map<string, PhaseDoc>()

function splitAgent(body: string): { body: string; agent: string | undefined } {
  const lines = body.split('\n')
  const start = lines.findIndex(line => line.trim() === AGENT_HEADING)
  if (start < 0) return { body: body.trim(), agent: undefined }
  const length = lines.slice(start + 1).findIndex(line => line.startsWith('## '))
  const end = length < 0 ? lines.length : start + 1 + length
  return {
    body: [...lines.slice(0, start), ...lines.slice(end)].join('\n').trim(),
    agent: lines.slice(start + 1, end).join('\n').trim(),
  }
}

export async function readPhase($: EngineInterface, phase: Phase): Promise<PhaseDoc> {
  const path = `${$.plugin.root}/phases/${phase}.md`
  const cached = loaded.get(path)
  if (cached !== undefined) return cached
  const { data, body } = parseFrontmatter(await $.fs.read(path))
  const writes = data.writes
  const doc = { writes: writes === undefined ? [] : typeof writes === 'string' ? [writes] : [...writes], ...splitAgent(body) }
  loaded.set(path, doc)
  return doc
}

export function writeScope(doc: PhaseDoc, workflow: Workflow, specsDir: string): string[] {
  return doc.writes.map(glob => glob.replaceAll('{specsDir}', specsDir).replaceAll('{slug}', workflow.slug))
}
