import type { EngineInterface } from 'claude-code'

import { parseFrontmatter } from './frontmatter'
import type { Phase, Workflow } from './state'

export type PhaseDoc = { writes: string[]; body: string }

const loaded = new Map<string, PhaseDoc>()

export async function readPhase($: EngineInterface, phase: Phase): Promise<PhaseDoc> {
  const path = `${$.plugin.root}/phases/${phase}.md`
  const cached = loaded.get(path)
  if (cached !== undefined) return cached
  const { data, body } = parseFrontmatter(await $.fs.read(path))
  const writes = data.writes
  const doc = { writes: writes === undefined ? [] : typeof writes === 'string' ? [writes] : [...writes], body: body.trim() }
  loaded.set(path, doc)
  return doc
}

export function writeScope(doc: PhaseDoc, workflow: Workflow, specsDir: string): string[] {
  return doc.writes.map(glob => glob.replaceAll('{specsDir}', specsDir).replaceAll('{slug}', workflow.slug))
}
