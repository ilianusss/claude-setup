import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

export const ROOT = '/repo'
export const STATE_DIR = `${ROOT}/.git/claude-workflow`
export const NOW = Date.parse('2026-10-22T10:00:00.000Z')
export const DAY = 86_400_000

export const CONFIG = {
  testGlobs: ['**/*.test.ts'],
  testConfig: ['vitest.config.ts'],
  commands: { test: 'pnpm test', testFiles: 'pnpm vitest run {files}', lint: 'pnpm lint', typecheck: 'pnpm tsc --noEmit' },
}

const PHASE_WRITES: Record<string, string> = {
  setup: '["CLAUDE.md", ".claude/**"]',
  spec: '["{specsDir}/{slug}/**"]',
  design: '["{specsDir}/{slug}/**", "docs/adr/**"]',
  slice: '["{specsDir}/{slug}/**"]',
  build: '["**"]',
  inspect: '["**"]',
  retro: '["{specsDir}/{slug}/**", "CLAUDE.md", ".claude/**", "docs/**"]',
}

export type Fake = {
  files: Map<string, string>
  committed: Map<string, string>
  branch: string
  behind: number
  gitLog: string
  prompts: string[]
  commands: string[]
  statuses: Array<string | undefined>
  toasts: string[]
  tools: string[]
  answers: string[]
  questions: string[]
  bash: Map<string, number>
  clock: MockClock
}

function fnv(text: string): string {
  let hash = 0x811c9dc5
  for (const char of text) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0
  return hash.toString(16)
}

function workingFiles(fake: Fake): string[] {
  return [...fake.files.keys()]
    .filter(path => path.startsWith(`${ROOT}/`) && !path.startsWith(`${ROOT}/.git/`))
    .map(path => path.slice(ROOT.length + 1))
    .sort()
}

function git(fake: Fake, args: readonly string[]): { exitCode: number; stdout: string } {
  const line = args.join(' ')
  const ok = (stdout: string) => ({ exitCode: 0, stdout })
  if (line === 'rev-parse --path-format=absolute --show-toplevel --git-common-dir') return ok(`${ROOT}\n${ROOT}/.git\n`)
  if (line === 'symbolic-ref --quiet --short HEAD') return ok(`${fake.branch}\n`)
  if (line === 'add -A') return ok('')
  if (line === 'write-tree') return ok(`${fnv(workingFiles(fake).map(path => `${path}:${fake.files.get(`${ROOT}/${path}`)}`).join('\n'))}\n`)
  if (line === 'diff --name-only HEAD') {
    return ok(workingFiles(fake).filter(path => fake.committed.has(path) && fake.committed.get(path) !== fake.files.get(`${ROOT}/${path}`)).join('\n'))
  }
  if (line === 'ls-files --others --exclude-standard') return ok(workingFiles(fake).filter(path => !fake.committed.has(path)).join('\n'))
  if (args[0] === 'switch') {
    fake.branch = args[args.length - 1] ?? fake.branch
    return ok('')
  }
  if (args[0] === 'worktree') return ok('')
  if (line === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') return ok('origin/main\n')
  if (line === 'rev-list --count HEAD..origin/main') return ok(`${fake.behind}\n`)
  if (args[0] === 'log') return ok(fake.gitLog)
  if (args[0] === 'diff' && args[1] === '--stat') return ok('')
  return { exitCode: 1, stdout: '' }
}

function children(fake: Fake, dir: string): Array<{ name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }> {
  const names = new Map<string, 'file' | 'dir'>()
  for (const path of fake.files.keys()) {
    if (!path.startsWith(`${dir}/`)) continue
    const [name, ...rest] = path.slice(dir.length + 1).split('/')
    if (name !== undefined) names.set(name, rest.length > 0 ? 'dir' : 'file')
  }
  if (names.size === 0) throw new Error(`ENOENT: ${dir}`)
  return [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false }))
}

function shippedFile(path: string): string | undefined {
  const match = /\/(phases|guides|templates)\/([\w-]+)\.(md|json)$/.exec(path)
  if (match === null) return undefined
  const [, folder, name] = match
  if (folder === 'phases') return `---\nwrites: ${PHASE_WRITES[name ?? ''] ?? '[]'}\n---\n# The ${name} phase\n\nDo the ${name} work.\n`
  return `# ${name}\n`
}

export function fakeEngine(on: On, files: Record<string, string> = {}, branch = 'main'): Fake {
  const fake: Fake = {
    files: new Map(Object.entries(files)),
    committed: new Map(),
    branch,
    behind: 0,
    gitLog: '',
    prompts: [],
    commands: [],
    statuses: [],
    toasts: [],
    tools: [],
    answers: [],
    questions: [],
    bash: new Map(),
    clock: mock.clock(on, { now: NOW }),
  }
  mock.store(on)

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', (_, e) => {
    const text = fake.files.get(e.path) ?? shippedFile(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_, e) => {
    fake.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: fake.files.has(e.path) || [...fake.files.keys()].some(path => path.startsWith(`${e.path}/`)) }))
  on('fs.list', (_, e) => ({ value: children(fake, e.path) }))
  on('process.run', (_, e) => {
    const ran = e.argv[0] === 'git' ? git(fake, e.argv.slice(1)) : { exitCode: 127, stdout: '' }
    return { value: { ...ran, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', (_, e) => {
    const input = e as unknown as Record<string, unknown>
    if (e.tool === 'AskUserQuestion') {
      const questions = input.questions as Array<{ question: string }>
      const question = questions[0]?.question ?? ''
      fake.questions.push(question)
      const answer = fake.answers.shift()
      if (answer === undefined) throw new Error('the dialog was dismissed')
      return { result: { questions, answers: { [question]: answer } }, text: answer }
    }
    if (e.tool === 'Edit') {
      const path = String(input.file_path)
      fake.files.set(path, (fake.files.get(path) ?? '').replace(String(input.old_string), String(input.new_string)))
    }
    if (e.tool === 'Write') fake.files.set(String(input.file_path), String(input.content))
    if (e.tool === 'Bash') {
      const exitCode = fake.bash.get(String(input.command)) ?? 0
      return exitCode === 0
        ? { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }
        : { isError: true, result: undefined, text: `Exit code ${exitCode}\nFAIL` }
    }
    return { result: {}, text: 'ok' }
  })
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.register', (_, e) => {
    fake.tools.push(`mcp__workflow__${e.name}`)
    return { value: { tool: `mcp__workflow__${e.name}` } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.run', (_, e) => {
    fake.commands.push(e.command)
    return { text: '' }
  })
  on('prompt.submit', (_, e) => {
    fake.prompts.push(e.text)
    return { text: e.text }
  })
  on('ui.status', (_, e) => {
    fake.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    fake.toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return fake
}

export function stateText(fields: Partial<Record<string, string>> = {}): string {
  const data = {
    slug: 'login',
    title: 'Add login',
    size: 'feature',
    phase: 'build',
    status: 'active',
    branch: 'feat/login',
    worktree: ROOT,
    slice: '1',
    commits: 'no',
    auto_next: 'no',
    paths: '[src]',
    session: 's0',
    updated: new Date(NOW).toISOString(),
    ...fields,
  }
  const frontmatter = Object.entries(data)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
  return `---\n${frontmatter}\n---\n\n# Add login\n\n## Goal\n\nUsers sign in.\n\n## Next action\n\nWrite slice 1 tests.\n`
}

export const SLICES = `# Slices: login

## Slice 1: Walking skeleton
- [ ] Done

Goal: a form posts to a stub route.
Design: Components

## Slice 2: Password check
- [ ] Done

Goal: wrong passwords are refused.
Design: API contracts
`

export function buildRepo(extra: Record<string, string> = {}): Record<string, string> {
  return {
    [`${ROOT}/.claude/workflow.json`]: JSON.stringify(CONFIG),
    [`${ROOT}/docs/specs/login/slices.md`]: SLICES,
    [`${ROOT}/docs/specs/login/design.md`]: '# Design\n\n## Components\n\nForm and route.\n\n## API contracts\n\nPOST /login.\n',
    [`${STATE_DIR}/login.md`]: stateText(),
    ...extra,
  }
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

export function run($: Engine, args: string) {
  return $.command.run({ command: 'workflow', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
}
