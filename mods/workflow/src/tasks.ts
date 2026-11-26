// The prompts the conversation spawns workflow:build with: the spawn hook reads the task back from them.
export type Task = { kind: 'build' | 'resolve'; slice: number } | { kind: 'integration' }

export function buildTask(slug: string, slice: number): string {
  return `Build slice ${slice} of \`${slug}\`.`
}

export function resolveTask(slug: string, slice: number): string {
  return `Resolve the merge of slice ${slice} of \`${slug}\`.`
}

export function integrationTask(slug: string): string {
  return `Fix the integration of \`${slug}\`.`
}

function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A prompt that names no task, or two, says nothing the hook can act on.
export function parseTask(prompt: string, slug: string): Task | undefined {
  const named = literal(`\`${slug}\``)
  const found: Task[] = [
    ...[...prompt.matchAll(new RegExp(`Build slice (\\d+) of ${named}\\.`, 'g'))].map(match => ({ kind: 'build' as const, slice: Number(match[1]) })),
    ...[...prompt.matchAll(new RegExp(`Resolve the merge of slice (\\d+) of ${named}\\.`, 'g'))].map(match => ({ kind: 'resolve' as const, slice: Number(match[1]) })),
    ...[...prompt.matchAll(new RegExp(`Fix the integration of ${named}\\.`, 'g'))].map(() => ({ kind: 'integration' as const })),
  ]
  return found.length === 1 ? found[0] : undefined
}
