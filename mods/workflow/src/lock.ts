export type LockedFile = { hash: string; content: string }

export type Lock = {
  slug: string
  slice: number
  phase: 'green' | 'open'
  files: Record<string, LockedFile>
  sliceFiles: string[]
  unlocked: string[]
  updated: string
}

export type Run = { command: string; exitCode: number; tree: string; at: string }

const IMPORT =
  /^(?:import\b|export\s+(?:\*|\{[^}]*\})\s+from\b|from\s+\S+\s+import\b|use\s|#include\b|(?:const|let|var|local)\s+[\w{}\s,]+=\s*require\s*\(|require\s*\()/

function significantLines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !IMPORT.test(line))
}

export function removedLines(before: string, after: string): string[] {
  const remaining = new Map<string, number>()
  for (const line of significantLines(after)) remaining.set(line, (remaining.get(line) ?? 0) + 1)
  const removed: string[] = []
  for (const line of significantLines(before)) {
    const count = remaining.get(line) ?? 0
    if (count > 0) remaining.set(line, count - 1)
    else removed.push(line)
  }
  return removed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseLock(text: string): Lock {
  const raw: unknown = JSON.parse(text)
  if (!isRecord(raw) || !isRecord(raw.files) || (raw.phase !== 'green' && raw.phase !== 'open')) {
    throw new Error('the lock file is not a workflow lock')
  }
  return raw as Lock
}

export function renderLock(lock: Lock): string {
  return `${JSON.stringify(lock, null, 2)}\n`
}

export function latestRun(runs: readonly Run[], command: string): Run | undefined {
  return [...runs].reverse().find(run => run.command === command)
}
