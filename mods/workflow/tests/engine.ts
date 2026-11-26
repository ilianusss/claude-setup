import type { AgentSpawnInput, AgentSpec, AgentStatus, On, PaneOpenArgs } from 'claude-code'
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

export const BUILD_PHASE = `# The build phase

Build the current slice.

## With the user

Talk the user through the slice.

## Agent

Do the build work.
`

export const INTAKE_PHASE = `# The intake phase

## With the user

1. **Read** the workflow title and the project README.
2. **Listen.** Invite the user to describe, in their own words, what they want, then wait.
3. **Fill the gaps.** Ask only about the points the description leaves out or leaves unclear:
   - The problem: what is wrong or missing today.
   - The result wanted: what exists once this workflow is done.
   - How success will show: what the user will see.
   - The limits: what must not change.
   - Out of scope: what this workflow will not do.
4. **Recommend models** for the steps that need another model or effort than the default.
5. **Gate.** Call mcp__workflow__advance with the five points as you understood them: the user confirms or corrects them in the gate dialog.
`

export const INTAKE_POINTS = {
  problem: 'Users cannot sign in.',
  result: 'Users sign in with email and password.',
  success: 'A working session after sign-in.',
  limits: 'No new dependency.',
  outOfScope: 'No SSO.',
}

export const INTAKE_GOAL = [
  'Problem: Users cannot sign in.',
  'Result: Users sign in with email and password.',
  'Success: A working session after sign-in.',
  'Limits: No new dependency.',
  'Out of scope: No SSO.',
].join('\n')

export const CONTINUE = '/workflow continue'

export const REVIEWER_AGENT = '---\nname: reviewer\ntools: Read, Grep, Glob, Bash\nskills:\n  - writing-clean-code\n---\n\nYou review a change you did not write.\n'

const PHASES_WITH_AGENT = ['setup', 'spec', 'design', 'slice', 'inspect']

function phaseWithAgent(name: string): string {
  const map = name === 'design' ? '\n## Map agent\n\nMap the project.\n' : ''
  return `# The ${name} phase\n\n## With the user\n\nDo the ${name} work.\n\n## Agent\n\nWork as the ${name} agent.\n${map}`
}

export type Fake = {
  files: Map<string, string>
  committed: Map<string, string>
  branch: string
  toplevel: string
  isLinked: boolean
  behind: number
  gitLog: string
  prompts: string[]
  fills: string[]
  fillMode: 'fills' | 'refuses' | 'breaks'
  commands: string[]
  statuses: Array<string | undefined>
  toasts: string[]
  tools: string[]
  agents: AgentSpec[]
  answers: string[]
  questions: string[]
  bash: Map<string, number>
  shellWrites: Map<string, Record<string, string>>
  missing: string[]
  trees: Map<string, Map<string, string>>
  clock: MockClock
  isPlaced: boolean
  opened: PaneOpenArgs[]
  closed: string[]
  porcelain: string
  unpushed: string | undefined
  refs: Map<string, string>
  worktreeRemoveExit: number
  gitRuns: Array<{ cwd: string; line: string }>
  rmRuns: string[][]
  // The folder $.session.cwd() answers: a lane's worktree stands for a hook raised by an agent working there.
  cwd: string
  // The lane worktrees git created, by path, each with its branch, its status and whether its branch is merged.
  // `mergeHead` and `secondParent` stand for a merge of another branch into the lane: stopped on a conflict, or committed.
  lanes: Map<string, { branch: string; porcelain: string; base?: Map<string, string>; mergeHead?: string; secondParent?: string }>
  unmerged: Set<string>
  mergeExit: number
  worktreeAddExit: number
  commitExit: number
  branchDeleteExit: number
  spawns: AgentSpawnInput[]
  indexFiles: string[]
  // Whether a merge is in progress in the workflow worktree, as MERGE_HEAD tells git.
  mergeHead: boolean
  // Whether a failed merge leaves MERGE_HEAD (a conflict) or not (git refused to start it).
  conflictLeavesHead: boolean
  agentStatus: Map<string, AgentStatus>
  // Runs while a dialog of the mod is open, before it is answered.
  onAsk: (() => Promise<void>) | undefined
  // What `git status --ignored --porcelain` lists; undefined when the fake cannot list it, as before.
  ignoredListing: string | undefined
}

function fnv(text: string): string {
  let hash = 0x811c9dc5
  for (const char of text) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0
  return hash.toString(16)
}

function workingFiles(fake: Fake, root = ROOT): string[] {
  return [...fake.files.keys()]
    .filter(path => path.startsWith(`${root}/`) && !path.startsWith(`${root}/.git/`))
    .map(path => path.slice(root.length + 1))
    .sort()
}

function laneAt(fake: Fake, cwd: string): string | undefined {
  return [...fake.lanes.keys()].find(path => cwd === path || cwd.startsWith(`${path}/`))
}

function copyFiles(fake: Fake, from: string, to: string): void {
  for (const path of workingFiles(fake, from)) fake.files.set(`${to}/${path}`, fake.files.get(`${from}/${path}`) ?? '')
}

type Edit = { start: number; end: number; lines: string[] }

function linesOf(text: string): string[] {
  return text === '' ? [] : text.replace(/\n$/, '').split('\n')
}

// The edits that turn base into side: runs of base lines replaced, found from a longest common subsequence.
function editsOf(base: readonly string[], side: readonly string[]): Edit[] {
  const common = Array.from({ length: base.length + 1 }, () => new Array<number>(side.length + 1).fill(0))
  for (let i = base.length - 1; i >= 0; i -= 1) {
    for (let j = side.length - 1; j >= 0; j -= 1) {
      common[i]![j] = base[i] === side[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!)
    }
  }
  const edits: Edit[] = []
  let current: Edit | undefined
  let i = 0
  let j = 0
  while (i < base.length || j < side.length) {
    if (i < base.length && j < side.length && base[i] === side[j]) {
      if (current !== undefined) edits.push(current)
      current = undefined
      i += 1
      j += 1
      continue
    }
    current ??= { start: i, end: i, lines: [] }
    if (j < side.length && (i === base.length || common[i]![j + 1]! >= common[i + 1]![j]!)) {
      current.lines.push(side[j]!)
      j += 1
    } else {
      i += 1
      current.end = i
    }
  }
  if (current !== undefined) edits.push(current)
  return edits
}

function isSameEdit(a: Edit, b: Edit): boolean {
  return a.start === b.start && a.end === b.end && a.lines.join('\n') === b.lines.join('\n')
}

// A three-way merge of whole lines, as git makes one: edits of both sides that touch or overlap the same base lines
// conflict, unless they are the same edit, and a conflict is written between markers.
export function threeWay(base: string, ours: string, theirs: string): { text: string; conflicts: number } {
  const lines = linesOf(base)
  const edits = [...editsOf(lines, linesOf(ours)).map(edit => ({ ...edit, side: 'ours' })), ...editsOf(lines, linesOf(theirs)).map(edit => ({ ...edit, side: 'theirs' }))].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )
  const applied: Edit[] = []
  let conflicts = 0
  for (const edit of edits) {
    const last = applied.at(-1)
    if (last === undefined || edit.start > last.end) {
      applied.push(edit)
      continue
    }
    if (isSameEdit(last, edit)) continue
    conflicts += 1
    applied[applied.length - 1] = {
      start: last.start,
      end: Math.max(last.end, edit.end),
      lines: ['<<<<<<< ours', ...last.lines, '=======', ...edit.lines, '>>>>>>> theirs'],
    }
  }
  const out: string[] = []
  let at = 0
  for (const edit of applied) {
    out.push(...lines.slice(at, edit.start), ...edit.lines)
    at = edit.end
  }
  out.push(...lines.slice(at))
  return { text: out.length === 0 ? '' : `${out.join('\n')}\n`, conflicts }
}

// As git merges a branch: what the lane changed since it was made is merged with what the workflow worktree changed.
function mergeFiles(fake: Fake, lane: string, base: Map<string, string> | undefined): number {
  let conflicts = 0
  for (const path of workingFiles(fake, lane)) {
    const theirs = fake.files.get(`${lane}/${path}`) ?? ''
    const from = base?.get(path)
    if (from === theirs) continue
    const ours = fake.files.get(`${ROOT}/${path}`)
    const merged = ours === undefined || ours === from || base === undefined ? { text: theirs, conflicts: 0 } : threeWay(from ?? '', ours, theirs)
    conflicts += merged.conflicts
    fake.files.set(`${ROOT}/${path}`, merged.text)
  }
  return conflicts
}

// A lane that merged the workflow branch in has it as merge base from then on.
export function laneMergedWorkflow(fake: Fake, lane: string): void {
  const found = fake.lanes.get(lane)
  if (found !== undefined) found.base = new Map(workingFiles(fake, ROOT).map(path => [path, fake.files.get(`${ROOT}/${path}`) ?? '']))
}

function laneGit(fake: Fake, lane: string, args: readonly string[]): { exitCode: number; stdout: string } | undefined {
  const line = args.join(' ')
  const ok = (stdout: string) => ({ exitCode: 0, stdout })
  const { branch, porcelain } = fake.lanes.get(lane) ?? { branch: '', porcelain: '' }
  if (line === 'rev-parse --path-format=absolute --show-toplevel --git-common-dir --git-dir') {
    return ok(`${lane}\n${ROOT}/.git\n${ROOT}/.git/worktrees/${lane.split('/').pop() ?? ''}\n`)
  }
  if (line === 'symbolic-ref --quiet --short HEAD') return ok(`${branch}\n`)
  if (line === 'status --porcelain --untracked-files=normal') return ok(porcelain)
  const found = fake.lanes.get(lane)
  if (line === 'rev-parse --verify --quiet MERGE_HEAD') return found?.mergeHead === undefined ? { exitCode: 1, stdout: '' } : ok(`${found.mergeHead}\n`)
  if (line === 'rev-parse --verify --quiet HEAD^2') return found?.secondParent === undefined ? { exitCode: 1, stdout: '' } : ok(`${found.secondParent}\n`)
  if (line === 'write-tree') return ok(`${treeOf(fake, lane)}\n`)
  if (line === 'diff --name-only HEAD') {
    return ok(workingFiles(fake, lane).filter(path => fake.committed.has(path) && fake.committed.get(path) !== fake.files.get(`${lane}/${path}`)).join('\n'))
  }
  if (line === 'ls-files --others --exclude-standard') return ok(workingFiles(fake, lane).filter(path => !fake.committed.has(path)).join('\n'))
  return undefined
}

function treeOf(fake: Fake, root: string): string {
  const snapshot = new Map(workingFiles(fake, root).map(path => [path, fake.files.get(`${root}/${path}`) ?? '']))
  const hash = fnv([...snapshot].map(([path, text]) => `${path}:${text}`).join('\n'))
  fake.trees.set(hash, snapshot)
  return hash
}

function laneCommands(fake: Fake, args: readonly string[]): { exitCode: number; stdout: string } | undefined {
  const ok = (stdout: string) => ({ exitCode: 0, stdout })
  const [command, sub] = args
  if (command === 'worktree' && sub === 'add' && args.length === 6) {
    if (fake.worktreeAddExit !== 0) return { exitCode: fake.worktreeAddExit, stdout: '' }
    const [, , , branch = '', path = ''] = args
    copyFiles(fake, ROOT, path)
    fake.lanes.set(path, { branch, porcelain: '', base: new Map(workingFiles(fake, path).map(file => [file, fake.files.get(`${path}/${file}`) ?? ''])) })
    return ok('')
  }
  if (command === 'worktree' && sub === 'add' && args.length === 5) {
    fake.files.set(`${args[4] ?? ''}/.git`, `gitdir: ${ROOT}/.git/worktrees/x\n`)
    return ok('')
  }
  if (command === 'worktree' && sub === 'remove' && fake.lanes.has(args[2] ?? '')) {
    if (fake.worktreeRemoveExit !== 0) return { exitCode: fake.worktreeRemoveExit, stdout: '' }
    const path = args[2] ?? ''
    fake.lanes.delete(path)
    for (const file of [...fake.files.keys()].filter(file => file.startsWith(`${path}/`))) fake.files.delete(file)
    return ok('')
  }
  if (command === 'merge' && sub === '--no-ff') {
    if (fake.mergeExit !== 0) {
      fake.mergeHead = fake.conflictLeavesHead
      return { exitCode: fake.mergeExit, stdout: 'CONFLICT (content): Merge conflict in src/cart.ts' }
    }
    fake.mergeHead = true
    const lane = [...fake.lanes].find(([, found]) => found.branch === args[3])
    const conflicts = lane === undefined ? 0 : mergeFiles(fake, lane[0], lane[1].base)
    return conflicts === 0 ? ok('') : { exitCode: 1, stdout: 'CONFLICT (content): Merge conflict' }
  }
  if (command === 'merge' && sub === '--abort') {
    if (!fake.mergeHead) return { exitCode: 128, stdout: 'fatal: There is no merge to abort (MERGE_HEAD missing).' }
    fake.mergeHead = false
    return ok('')
  }
  if (args.join(' ') === 'rev-parse -q --verify MERGE_HEAD') return fake.mergeHead ? ok('abc\n') : { exitCode: 1, stdout: '' }
  if (command === 'merge-file') {
    const [ours = '', base = '', theirs = ''] = args.slice(args.indexOf('--') + 1)
    const merged = threeWay(fake.files.get(base) ?? '', fake.files.get(ours) ?? '', fake.files.get(theirs) ?? '')
    return { exitCode: merged.conflicts, stdout: merged.text }
  }
  if (command === 'add' && sub === '--') return ok('')
  if (command === 'commit') {
    if (fake.commitExit === 0) fake.mergeHead = false
    return { exitCode: fake.commitExit, stdout: '' }
  }
  if (command === 'branch' && sub === '-d') return { exitCode: fake.branchDeleteExit, stdout: '' }
  if (command === 'merge-base') return { exitCode: fake.unmerged.has((args[2] ?? '').replace('refs/heads/', '')) ? 1 : 0, stdout: '' }
  return undefined
}

function git(fake: Fake, args: readonly string[], cwd: string): { exitCode: number; stdout: string } {
  const lane = laneAt(fake, cwd)
  const inLane = lane === undefined ? undefined : laneGit(fake, lane, args)
  if (inLane !== undefined) return inLane
  const forLanes = laneCommands(fake, args)
  if (forLanes !== undefined) return forLanes
  const line = args.join(' ')
  const ok = (stdout: string) => ({ exitCode: 0, stdout })
  if (line === 'rev-parse --path-format=absolute --show-toplevel --git-common-dir --git-dir') {
    return ok(`${fake.toplevel}\n${ROOT}/.git\n${fake.isLinked ? `${ROOT}/.git/worktrees/x` : `${ROOT}/.git`}\n`)
  }
  if (line === 'symbolic-ref --quiet --short HEAD') return ok(`${fake.branch}\n`)
  if (line === 'add -A') return ok('')
  if (line === 'write-tree') {
    const snapshot = new Map(workingFiles(fake).map(path => [path, fake.files.get(`${ROOT}/${path}`) ?? '']))
    const hash = fnv([...snapshot].map(([path, text]) => `${path}:${text}`).join('\n'))
    fake.trees.set(hash, snapshot)
    return ok(`${hash}\n`)
  }
  if (args[0] === 'diff-tree') {
    const [before, after] = [fake.trees.get(args[3] ?? '') ?? new Map<string, string>(), fake.trees.get(args[4] ?? '') ?? new Map<string, string>()]
    const paths = [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path))
    return ok(paths.sort().join('\n'))
  }
  if (line === 'diff --name-only HEAD') {
    return ok(workingFiles(fake).filter(path => fake.committed.has(path) && fake.committed.get(path) !== fake.files.get(`${ROOT}/${path}`)).join('\n'))
  }
  if (line === 'ls-files --others --exclude-standard') return ok(workingFiles(fake).filter(path => !fake.committed.has(path)).join('\n'))
  if (args[0] === 'switch') {
    fake.branch = args[args.length - 1] ?? fake.branch
    return ok('')
  }
  if (line === 'status --porcelain --untracked-files=normal') return ok(fake.porcelain)
  if (line === 'status --ignored --porcelain' && fake.ignoredListing !== undefined) return ok(fake.ignoredListing)
  if (line === 'rev-list @{u}..HEAD') return fake.unpushed === undefined ? { exitCode: 128, stdout: '' } : ok(fake.unpushed)
  if (args[0] === 'rev-parse' && args[1] === '--verify' && args[2] === '--quiet') {
    const commit = fake.refs.get(args[3] ?? '')
    return commit === undefined ? { exitCode: 1, stdout: '' } : ok(`${commit}\n`)
  }
  if (args[0] === 'worktree' && args[1] === 'remove') return { exitCode: fake.worktreeRemoveExit, stdout: '' }
  if (args[0] === 'branch' && args[1] === '-D') {
    fake.refs.delete(args[2] ?? '')
    return ok('')
  }
  if (args[0] === 'worktree') return ok('')
  if (line === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') return ok('origin/main\n')
  if (line === 'rev-list --count HEAD..origin/main') return ok(`${fake.behind}\n`)
  if (args[0] === 'log') return ok(fake.gitLog)
  if (args[0] === 'diff' && args[1] === '--stat') return ok('')
  return { exitCode: 1, stdout: '' }
}

function rm(fake: Fake, args: readonly string[]): { exitCode: number; stdout: string } {
  for (const path of args.filter(arg => !arg.startsWith('-'))) fake.files.delete(path)
  return { exitCode: 0, stdout: '' }
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
  if (path.endsWith('/agents/reviewer.md')) return REVIEWER_AGENT
  const match = /\/(phases|guides|templates)\/([\w-]+)\.(md|json)$/.exec(path)
  if (match === null) return undefined
  const [, folder, name] = match
  if (folder === 'phases' && name === 'build') return `---\nwrites: ["**"]\n---\n${BUILD_PHASE}`
  if (folder === 'phases' && name === 'intake') return `---\nwrites: []\n---\n${INTAKE_PHASE}`
  if (folder === 'phases' && PHASES_WITH_AGENT.includes(name ?? '')) {
    return `---\nwrites: ${PHASE_WRITES[name ?? ''] ?? '[]'}\n---\n${phaseWithAgent(name ?? '')}`
  }
  if (folder === 'phases') return `---\nwrites: ${PHASE_WRITES[name ?? ''] ?? '[]'}\n---\n# The ${name} phase\n\nDo the ${name} work.\n`
  return `# ${name}\n`
}

export function fakeEngine(on: On, files: Record<string, string> = {}, branch = 'main'): Fake {
  const fake: Fake = {
    files: new Map(Object.entries(files)),
    committed: new Map(),
    branch,
    toplevel: ROOT,
    isLinked: false,
    behind: 0,
    gitLog: '',
    prompts: [],
    fills: [],
    fillMode: 'fills',
    commands: [],
    statuses: [],
    toasts: [],
    tools: [],
    agents: [],
    answers: [],
    questions: [],
    bash: new Map(),
    shellWrites: new Map(),
    missing: [],
    trees: new Map(),
    clock: mock.clock(on, { now: NOW }),
    isPlaced: true,
    opened: [],
    closed: [],
    porcelain: '',
    unpushed: undefined,
    refs: new Map(),
    worktreeRemoveExit: 0,
    gitRuns: [],
    rmRuns: [],
    cwd: ROOT,
    lanes: new Map(),
    unmerged: new Set(),
    mergeExit: 0,
    worktreeAddExit: 0,
    commitExit: 0,
    branchDeleteExit: 0,
    spawns: [],
    indexFiles: [],
    mergeHead: false,
    conflictLeavesHead: true,
    agentStatus: new Map(),
    onAsk: undefined,
    ignoredListing: undefined,
  }
  mock.store(on)

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: fake.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', (_, e) => {
    if (fake.missing.some(suffix => e.path.endsWith(suffix))) throw new Error(`ENOENT: ${e.path}`)
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
    if (e.argv[0] === 'git') fake.gitRuns.push({ cwd: e.init?.cwd ?? '', line: e.argv.slice(1).join(' ') })
    if (e.argv[0] === 'rm') fake.rmRuns.push(e.argv.slice(1))
    const indexFile = e.init?.env?.GIT_INDEX_FILE
    if (indexFile !== undefined) fake.indexFiles.push(indexFile)
    const ran =
      e.argv[0] === 'git'
        ? git(fake, e.argv.slice(1), e.init?.cwd ?? fake.cwd)
        : e.argv[0] === 'rm'
          ? rm(fake, e.argv.slice(1))
          : e.argv[0] === 'mkdir'
            ? { exitCode: 0, stdout: '' }
            : { exitCode: 127, stdout: '' }
    return { value: { ...ran, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', async (_, e) => {
    const input = e as unknown as Record<string, unknown>
    if (e.tool === 'AskUserQuestion') {
      const questions = input.questions as Array<{ question: string }>
      const question = questions[0]?.question ?? ''
      fake.questions.push(question)
      await fake.onAsk?.()
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
      for (const [path, text] of Object.entries(fake.shellWrites.get(String(input.command)) ?? {})) {
        fake.files.set(path.startsWith('/') ? path : `${ROOT}/${path}`, text)
      }
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
  on('agent.spawn', (_, e) => {
    fake.spawns.push(e)
    return { model: e.model ?? 'opus', agentId: `agent-${fake.spawns.length}` }
  })
  on('agent.register', (_, e) => {
    fake.agents.push(e)
    return { value: { agent: `workflow:${e.name}` } }
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
  on('prompt.fill', (_, e) => {
    if (fake.fillMode === 'breaks') throw new Error('the prompt box is gone')
    if (fake.fillMode === 'refuses') return { isFilled: false }
    fake.fills.push(e.text)
    return { isFilled: true }
  })
  on('ui.status', (_, e) => {
    fake.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    fake.toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.open', (_, e) => {
    fake.opened.push(e)
    return { value: fake.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'the terminal is 80 columns wide, under 144' } }
  })
  on('ui.close', (_, e) => {
    fake.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('ui.render', { component: 'PromptHint' }, ($, e) => $.ui.resolve(e).Text({ dimColor: true, children: e.props.hint }))
  return fake
}

export const HINT_LINE = '? for shortcuts'

export const PROMPT_HINT = {
  plugin: 'workflow',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: HINT_LINE },
  viewport: { columns: 105, rows: 40 },
  surface: 'terminal',
} as const

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
Depends on: none

## Slice 2: Password check
- [ ] Done

Goal: wrong passwords are refused.
Design: API contracts
Depends on: Slice 1
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

export function spawnAgent($: Engine, prompt: string, fields: Partial<AgentSpawnInput> = {}) {
  return $.agent.spawn({
    tool_use_id: 'toolu_1',
    prompt,
    description: 'Build a slice',
    subagentType: 'workflow:build',
    provider: { plugin: 'workflow', tier: 'user' },
    parentModel: 'opus',
    background: true,
    fork: false,
    ...fields,
  })
}

export function run($: Engine, args: string) {
  return $.command.run({ command: 'workflow', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
}
