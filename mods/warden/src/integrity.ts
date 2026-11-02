import type { EngineInterface, On, ToolCallResult } from 'claude-code'

import { matchesAny } from './glob'

const DEFAULT_TEST_GLOBS = [
  '**/*.{test,spec}.*',
  '**/__tests__/**',
  '**/tests/**',
  '**/test/**',
  '**/spec/**',
  '**/e2e/**',
  '**/*_test.go',
  '**/test_*.py',
  '**/*_test.py',
]
const SNAPSHOT_GLOBS = ['**/__snapshots__/**', '**/*.snap']

const MARKERS: ReadonlyArray<readonly [label: string, pattern: RegExp]> = [
  ['.only', /\.only\s*\(/g],
  ['.skip', /(?<!mark|pytest)\.skip\s*\(/g],
  ['xit/xdescribe/xtest', /\bx(?:it|describe|test)\s*\(/g],
  ['fit/fdescribe', /\bf(?:it|describe)\s*\(/g],
  ['a pytest skip or xfail', /@pytest\.mark\.(?:skip|skipif|xfail)\b|\bpytest\.skip\s*\(/g],
  ['a unittest skip', /@unittest\.skip|\bself\.skipTest\s*\(/g],
  ['t.Skip', /\bt\.Skip(?:f|Now)?\s*\(/g],
  ['#[ignore]', /#\[ignore\]/g],
]
const ASSERTIONS =
  /\bexpect\s*\(|\bassert[A-Za-z_]*\b|\bt\.(?:Error|Errorf|Fatal|Fatalf)\s*\(|\brequire\.[A-Z]\w*\s*\(|\.should\b|\b(?:TEST_ASSERT|ASSERT|EXPECT)_\w+/g

const RULE =
  'CLAUDE.md forbids weakening a test: revert it, or keep it only if the user agreed, and list it in your report with the reason.'

export type IntegrityState = {
  cwd: string
  root: string | undefined
  globs: string[]
  reported: Set<string>
}

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function weakenings(before: string, after: string): string[] {
  const found = MARKERS.filter(([, pattern]) => count(after, pattern) > count(before, pattern)).map(
    ([label]) => `added ${label}`,
  )
  const removed = count(before, ASSERTIONS) - count(after, ASSERTIONS)
  if (removed > 0) return [...found, `removed ${plural(removed, 'assertion')}`]
  const kept = new Set(lines(after))
  const changed = lines(before).filter(line => count(line, ASSERTIONS) > 0 && !kept.has(line)).length
  return changed > 0 ? [...found, `changed ${plural(changed, 'existing assertion')}`] : found
}

export function changesByFile(diff: string): Map<string, { removed: string; added: string }> {
  const files = new Map<string, { removed: string[]; added: string[] }>()
  let current: { removed: string[]; added: string[] } | undefined
  let removedFrom: string | undefined
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- ')) {
      removedFrom = line.startsWith('--- a/') ? line.slice(6) : undefined
    } else if (line.startsWith('+++ ')) {
      const path = line.startsWith('+++ b/') ? line.slice(6) : removedFrom
      current = path === undefined ? undefined : { removed: [], added: [] }
      if (path !== undefined && current !== undefined) files.set(path, current)
    } else if (current !== undefined && line.startsWith('-')) {
      current.removed.push(line.slice(1))
    } else if (current !== undefined && line.startsWith('+')) {
      current.added.push(line.slice(1))
    }
  }
  return new Map([...files].map(([path, text]) => [path, { removed: text.removed.join('\n'), added: text.added.join('\n') }]))
}

async function gitRoot($: EngineInterface, cwd: string): Promise<string | undefined> {
  try {
    const ran = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd })
    return ran.exitCode === 0 ? ran.stdout.trim() : undefined
  } catch {
    return undefined
  }
}

async function uncommittedChanges($: EngineInterface, root: string): Promise<Map<string, { removed: string; added: string }> | undefined> {
  const diff = await $.process.run(['git', 'diff', 'HEAD', '-U0', '--no-color', '--no-ext-diff'], { cwd: root })
  return diff.exitCode === 0 ? changesByFile(diff.stdout) : undefined
}

async function projectTestGlobs($: EngineInterface, base: string): Promise<string[]> {
  try {
    const config: unknown = JSON.parse(await $.fs.read(`${base}/.claude/workflow.json`))
    const globs = typeof config === 'object' && config !== null ? (config as { testGlobs?: unknown }).testGlobs : undefined
    return Array.isArray(globs) ? globs.filter((glob): glob is string => typeof glob === 'string') : []
  } catch {
    return []
  }
}

async function readOrEmpty($: EngineInterface, path: string): Promise<string> {
  try {
    return await $.fs.read(path)
  } catch {
    return ''
  }
}

export function integrityState(): IntegrityState {
  return { cwd: '', root: undefined, globs: DEFAULT_TEST_GLOBS, reported: new Set() }
}

function relative(session: IntegrityState, path: string): string {
  const base = session.root ?? session.cwd
  return base !== '' && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
}

function isTest(session: IntegrityState, path: string): boolean {
  return matchesAny(relative(session, path), [...session.globs, ...SNAPSHOT_GLOBS])
}

function findingsFor(file: string, before: string, after: string): string[] {
  const found = weakenings(before, after)
  return matchesAny(file, SNAPSHOT_GLOBS) ? [...found, 'changed a snapshot: read every line of the change'] : found
}

function findingsIn(session: IntegrityState, changes: Map<string, { removed: string; added: string }>): string[] {
  return [...changes]
    .filter(([file]) => isTest(session, file))
    .flatMap(([file, change]) => findingsFor(file, change.removed, change.added).map(finding => `${file}: ${finding}`))
}

// Uncommitted weakenings from before the turn are not this turn's doing.
export async function weakeningsAtTurnStart($: EngineInterface, session: IntegrityState): Promise<void> {
  if (session.root === undefined) return
  const changes = await uncommittedChanges($, session.root)
  for (const key of changes === undefined ? [] : findingsIn(session, changes)) session.reported.add(key)
}

export function registerIntegrity(on: On, session: IntegrityState): void {
  const withNote = <T extends string>(ran: ToolCallResult<T>, path: string, before: string, after: string) => {
    if (ran.deny !== undefined || ran.isError === true || !isTest(session, path)) return ran
    const file = relative(session, path)
    const findings = findingsFor(file, before, after)
    if (findings.length === 0) return ran
    for (const finding of findings) session.reported.add(`${file}: ${finding}`)
    return { ...ran, context: [...(ran.context ?? []), `warden: ${file}: ${findings.join(', ')}. ${RULE}`] }
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const root = await gitRoot($, e.cwd)
    Object.assign(session, {
      cwd: e.cwd,
      root,
      globs: [...DEFAULT_TEST_GLOBS, ...(await projectTestGlobs($, root ?? e.cwd))],
      reported: new Set(),
    })
    return started
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => withNote(await next(e), e.file_path, e.old_string, e.new_string))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const before = isTest(session, e.file_path) ? await readOrEmpty($, e.file_path) : ''
    return withNote(await next(e), e.file_path, before, e.content)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer' || session.root === undefined) return completed
    const changes = await uncommittedChanges($, session.root)
    if (changes === undefined) return completed
    const fresh: string[] = []
    for (const key of findingsIn(session, changes)) {
      if (session.reported.has(key)) continue
      session.reported.add(key)
      fresh.push(key)
    }
    if (fresh.length > 0) {
      const text = ['warden: test files changed through the shell this turn:', ...fresh.map(key => `- ${key}`), RULE].join('\n')
      $.clock.after(0, () => void $.prompt.submit({ text }))
    }
    return completed
  })

}
