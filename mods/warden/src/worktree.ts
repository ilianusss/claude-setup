import type { EngineInterface, On } from 'claude-code'

export const CHOICES = {
  move: 'Move the work to a worktree',
  allow: 'Allow this checkout for this session',
}

const HEADER = 'Worktree'
const HASH_LIMIT = 500
const LISTED_LIMIT = 10
const ADVICE = 'Call EnterWorktree, then make this change in the worktree (CLAUDE.md, How to work).'

export type WorktreeState = {
  allowed: Set<string>
  asking: Map<string, Promise<string | undefined>>
}

export function worktreeState(): WorktreeState {
  return { allowed: new Set(), asking: new Map() }
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash <= 0 ? '/' : path.slice(0, slash)
}

async function nearestFolder($: EngineInterface, path: string): Promise<string> {
  let folder = parentOf(path)
  while (folder !== '/' && !(await $.fs.exists(folder))) folder = parentOf(folder)
  return folder
}

async function mainCheckout($: EngineInterface, cwd: string): Promise<string | undefined> {
  const paths = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'], { cwd })
  if (paths.exitCode !== 0) return undefined
  const [root, gitDir, commonDir] = paths.stdout.split('\n').map(line => line.trim())
  return root !== undefined && root.length > 0 && gitDir === commonDir ? root : undefined
}

function relative(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

async function ask($: EngineInterface, question: string): Promise<string | undefined> {
  try {
    return await $.ui.ask(question, { options: [CHOICES.move, CHOICES.allow], header: HEADER })
  } catch {
    return undefined
  }
}

// Edits sent together share one dialog per checkout instead of stacking several.
function answerFor($: EngineInterface, state: WorktreeState, root: string, question: string): Promise<string | undefined> {
  if (state.allowed.has(root)) return Promise.resolve(CHOICES.allow)
  const pending = state.asking.get(root)
  if (pending !== undefined) return pending
  const asked = ask($, question).then(answer => {
    if (answer === CHOICES.allow) state.allowed.add(root)
    state.asking.delete(root)
    return answer
  })
  state.asking.set(root, asked)
  return asked
}

function typedAnswer(answer: string | undefined): string {
  return answer === undefined || answer === CHOICES.move ? '' : ` The person answered: "${answer}".`
}

async function refusal($: EngineInterface, state: WorktreeState, path: string): Promise<{ deny: string } | undefined> {
  const root = await mainCheckout($, await nearestFolder($, path))
  if (root === undefined || state.allowed.has(root)) return undefined
  const ignored = await $.process.run(['git', 'check-ignore', '-q', '--', path], { cwd: root })
  if (ignored.exitCode === 0) return undefined
  const answer = await answerFor($, state, root, `Claude is about to change ${relative(root, path)} in the main checkout of ${root}.`)
  return answer === CHOICES.allow ? undefined : { deny: `warden: ${root} is a main checkout. ${ADVICE}${typedAnswer(answer)}` }
}

function checkFailed(what: string): { deny: string } {
  return { deny: `warden: the worktree check on ${what} failed, so the call is refused.` }
}

// A hash per changed file, so a file the person had already changed is caught when it changes again.
async function snapshot($: EngineInterface, root: string): Promise<Map<string, string> | undefined> {
  const status = await $.process.run(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root })
  if (status.exitCode !== 0) return undefined
  const files = new Map<string, string>()
  const fields = status.stdout.split('\0')
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? ''
    if (field.length < 4) continue
    const code = field.slice(0, 2)
    files.set(field.slice(3), code)
    if (/[RC]/.test(code)) index += 1
  }
  const present = [...files].filter(([, code]) => !code.includes('D')).map(([file]) => file).slice(0, HASH_LIMIT)
  if (present.length === 0) return files
  const hashes = await $.process.run(['git', 'hash-object', '--', ...present], { cwd: root })
  if (hashes.exitCode !== 0) return files
  hashes.stdout
    .trim()
    .split('\n')
    .forEach((hash, index) => {
      const file = present[index]
      if (file !== undefined) files.set(file, `${files.get(file) ?? ''} ${hash}`)
    })
  return files
}

async function shellSnapshot($: EngineInterface, state: WorktreeState): Promise<{ root: string; files: Map<string, string> } | undefined> {
  try {
    const root = await mainCheckout($, await $.session.cwd())
    if (root === undefined || state.allowed.has(root)) return undefined
    const files = await snapshot($, root)
    return files === undefined ? undefined : { root, files }
  } catch {
    return undefined
  }
}

function listed(files: readonly string[]): string[] {
  const shown = files.slice(0, LISTED_LIMIT).map(file => `- ${file}`)
  return files.length > LISTED_LIMIT ? [...shown, `- and ${files.length - LISTED_LIMIT} more`] : shown
}

function changedBetween(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter(file => before.get(file) !== after.get(file)).sort()
}

// A shell command cannot be read for the files it writes, so the checkout is compared around it. Around the
// command only: the person keeps editing the main checkout while Claude works, and those edits are theirs.
async function shellNote($: EngineInterface, state: WorktreeState, root: string, files: readonly string[]): Promise<string | undefined> {
  const answer = await answerFor($, state, root, [`A shell command changed files in the main checkout of ${root}:`, ...listed(files)].join('\n'))
  if (answer === CHOICES.allow) return undefined
  return [
    `warden: this command changed files in the main checkout of ${root}:`,
    ...listed(files),
    `Carry the changes into a worktree (EnterWorktree, then apply them there) and ask the person before restoring them in the main checkout.${typedAnswer(answer)}`,
  ].join('\n')
}

export function registerWorktree(on: On, state: WorktreeState): void {
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => (await refusal($, state, e.file_path)) ?? next(e)).catch(($, e, next) =>
    next.called ? next(e) : checkFailed('an Edit'),
  )

  on('tool.call', { tool: 'Write' }, async ($, e, next) => (await refusal($, state, e.file_path)) ?? next(e)).catch(($, e, next) =>
    next.called ? next(e) : checkFailed('a Write'),
  )

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => (await refusal($, state, e.notebook_path)) ?? next(e)).catch(($, e, next) =>
    next.called ? next(e) : checkFailed('a notebook edit'),
  )

  // A note after the fact, not a refusal: when the check itself fails, the command runs and its result comes back unchanged.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const before = await shellSnapshot($, state)
    const ran = await next(e)
    if (ran.deny !== undefined || before === undefined || state.allowed.has(before.root)) return ran
    const after = await snapshot($, before.root)
    const changed = after === undefined ? [] : changedBetween(before.files, after)
    const note = changed.length === 0 ? undefined : await shellNote($, state, before.root, changed)
    return note === undefined ? ran : { ...ran, context: [...(ran.context ?? []), note] }
  }).catch(($, e, next) => next(e))
}
