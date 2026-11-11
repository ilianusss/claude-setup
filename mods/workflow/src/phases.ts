import type { EngineInterface } from 'claude-code'

import { parseFrontmatter } from './frontmatter'
import { STEPS } from './plan'
import type { Step } from './plan'
import type { Phase, Workflow } from './state'

export const AGENT_SECTIONS = ['Agent', 'Map agent'] as const
export type AgentSection = (typeof AGENT_SECTIONS)[number]

export const STEP_SOURCES: Readonly<Record<Step, { phase: Phase; section: AgentSection }>> = {
  map: { phase: 'design', section: 'Map agent' },
  setup: { phase: 'setup', section: 'Agent' },
  spec: { phase: 'spec', section: 'Agent' },
  design: { phase: 'design', section: 'Agent' },
  slice: { phase: 'slice', section: 'Agent' },
  build: { phase: 'build', section: 'Agent' },
  review: { phase: 'inspect', section: 'Agent' },
}

export function stepOf(phase: Phase): Step | undefined {
  return STEPS.find(step => STEP_SOURCES[step].phase === phase && STEP_SOURCES[step].section === 'Agent')
}

export type PhaseDoc = {
  writes: string[]
  preamble: string
  body: string
  agents: Partial<Record<AgentSection, string>>
}

const loaded = new Map<string, PhaseDoc>()

function agentSectionOf(line: string): AgentSection | undefined {
  return AGENT_SECTIONS.find(name => line.trim() === `## ${name}`)
}

function splitAgents(text: string): Pick<PhaseDoc, 'preamble' | 'body' | 'agents'> {
  const kept: string[] = []
  const agents: Partial<Record<AgentSection, string[]>> = {}
  let current: string[] = kept
  let preambleLength: number | undefined
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      preambleLength ??= kept.length
      const section = agentSectionOf(line)
      current = section === undefined ? kept : (agents[section] = [])
      if (section !== undefined) continue
    }
    current.push(line)
  }
  return {
    preamble: kept.slice(0, preambleLength ?? kept.length).join('\n').trim(),
    body: kept.join('\n').trim(),
    agents: Object.fromEntries(Object.entries(agents).map(([name, lines]) => [name, lines.join('\n').trim()])),
  }
}

export async function readPhase($: EngineInterface, phase: Phase): Promise<PhaseDoc> {
  const path = `${$.plugin.root}/phases/${phase}.md`
  const cached = loaded.get(path)
  if (cached !== undefined) return cached
  const { data, body } = parseFrontmatter(await $.fs.read(path))
  const writes = data.writes
  const doc = { writes: writes === undefined ? [] : typeof writes === 'string' ? [writes] : [...writes], ...splitAgents(body) }
  loaded.set(path, doc)
  return doc
}

export function writeScope(doc: PhaseDoc, workflow: Workflow, specsDir: string): string[] {
  return doc.writes.map(glob => glob.replaceAll('{specsDir}', specsDir).replaceAll('{slug}', workflow.slug))
}
