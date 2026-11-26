import type { EngineInterface, ProcessRunResult } from 'claude-code'

export type Repo = { root: string; commonDir: string; branch: string; isLinked: boolean }

const DEFAULT_BRANCHES = ['main', 'master', 'trunk', 'develop', 'HEAD']

export function git(
  $: EngineInterface,
  cwd: string,
  args: readonly string[],
  env?: Record<string, string>,
): Promise<ProcessRunResult> {
  return $.process.run(['git', ...args], env === undefined ? { cwd } : { cwd, env })
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

export async function findRepo($: EngineInterface, cwd: string): Promise<Repo | undefined> {
  const paths = await git($, cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir', '--git-dir'])
  if (paths.exitCode !== 0) return undefined
  const [root, commonDir, gitDir] = lines(paths.stdout)
  if (root === undefined || commonDir === undefined || gitDir === undefined) return undefined
  const head = await git($, root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  return { root, commonDir, branch: head.exitCode === 0 ? head.stdout.trim() : 'HEAD', isLinked: gitDir !== commonDir }
}

export function isDefaultBranch(branch: string): boolean {
  return DEFAULT_BRANCHES.includes(branch)
}

// git writes the index file but not the folder it sits in, and a lane's sits in a folder of its own.
async function ensureFolderOf($: EngineInterface, file: string): Promise<void> {
  const folder = file.slice(0, file.lastIndexOf('/'))
  const made = await $.process.run(['mkdir', '-p', '--', folder])
  if (made.exitCode !== 0) throw new Error(`mkdir could not create ${folder}: ${made.stderr.trim()}`)
}

export async function treeHash($: EngineInterface, repo: Repo, indexFile: string): Promise<string> {
  await ensureFolderOf($, indexFile)
  const env = { GIT_INDEX_FILE: indexFile }
  const added = await git($, repo.root, ['add', '-A'], env)
  if (added.exitCode !== 0) throw new Error(`git add failed: ${added.stderr.trim()}`)
  const tree = await git($, repo.root, ['write-tree'], env)
  if (tree.exitCode !== 0) throw new Error(`git write-tree failed: ${tree.stderr.trim()}`)
  return tree.stdout.trim()
}

export async function changedFiles($: EngineInterface, repo: Repo): Promise<string[]> {
  const tracked = await git($, repo.root, ['diff', '--name-only', 'HEAD'])
  const untracked = await git($, repo.root, ['ls-files', '--others', '--exclude-standard'])
  return [...new Set([...(tracked.exitCode === 0 ? lines(tracked.stdout) : []), ...lines(untracked.stdout)])]
}

export async function switchBranch($: EngineInterface, repo: Repo, branch: string, create: boolean): Promise<void> {
  const switched = await git($, repo.root, create ? ['switch', '-c', branch] : ['switch', branch])
  if (switched.exitCode !== 0) throw new Error(`git could not switch to ${branch}: ${switched.stderr.trim()}`)
}

export async function addWorktree($: EngineInterface, repo: Repo, branch: string, path: string, base?: string): Promise<void> {
  const added = await git($, repo.root, ['worktree', 'add', '-b', branch, path, ...(base === undefined ? [] : [base])])
  if (added.exitCode !== 0) throw new Error(`git could not create the worktree: ${added.stderr.trim()}`)
}

const PORCELAIN_PREFIX = 3

export async function uncommittedFiles($: EngineInterface, cwd: string): Promise<string[]> {
  const status = await git($, cwd, ['status', '--porcelain', '--untracked-files=normal'])
  if (status.exitCode !== 0) throw new Error(`git could not read the status of ${cwd}: ${status.stderr.trim()}`)
  return status.stdout
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => line.slice(PORCELAIN_PREFIX).trim())
}

export async function isClean($: EngineInterface, cwd: string): Promise<boolean> {
  return (await uncommittedFiles($, cwd)).length === 0
}

async function commitOf($: EngineInterface, cwd: string, ref: string): Promise<string | undefined> {
  const found = await git($, cwd, ['rev-parse', '--verify', '--quiet', ref])
  return found.exitCode === 0 ? found.stdout.trim() : undefined
}

// Whether the folder is merging the branch's tip in: a merge stopped on a conflict (MERGE_HEAD), or one git just
// committed cleanly (HEAD's second parent). Either is the only time a locked test may take another version.
export async function isMergingIn($: EngineInterface, cwd: string, branch: string): Promise<boolean> {
  const tip = await commitOf($, cwd, `refs/heads/${branch}`)
  if (tip === undefined) return false
  return (await commitOf($, cwd, 'MERGE_HEAD')) === tip || (await commitOf($, cwd, 'HEAD^2')) === tip
}

const MERGE_FILE_ERROR = 128
let mergeFileCalls = 0

export type Versions = { ours: string; base: string; theirs: string }

// `git merge-file -p` on three temporary files in `folder`, which the caller names inside the state folder. Each call
// gets files of its own, so two calls cannot overwrite or delete each other's. Histogram is what `git merge` uses.
export async function mergeFile($: EngineInterface, folder: string, versions: Versions): Promise<{ isClean: boolean; text: string }> {
  mergeFileCalls += 1
  const call = `${await $.clock.now()}-${mergeFileCalls}`
  const files = { ours: `${folder}/${call}.ours`, base: `${folder}/${call}.base`, theirs: `${folder}/${call}.theirs` }
  try {
    for (const side of ['ours', 'base', 'theirs'] as const) await $.fs.write(files[side], versions[side])
    const merged = await git($, folder, ['merge-file', '-p', '--diff-algorithm=histogram', '--', files.ours, files.base, files.theirs])
    if (merged.exitCode >= MERGE_FILE_ERROR || merged.isStdoutTruncated) {
      throw new Error(`git could not merge the versions of a locked test: ${merged.stderr.trim()}`)
    }
    return { isClean: merged.exitCode === 0, text: merged.stdout }
  } finally {
    const removed = await $.process.run(['rm', '-f', '--', files.ours, files.base, files.theirs])
    if (removed.exitCode !== 0) $.ui.log(`workflow: rm could not delete the merge files in ${folder}: ${removed.stderr.trim()}`, { to: 'debug' })
  }
}

export async function isMerging($: EngineInterface, cwd: string): Promise<boolean> {
  return (await git($, cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).exitCode === 0
}

// Leaves the merge uncommitted so the caller adds its own change to the merge commit; on a conflict it aborts the merge
// git started, leaving the worktree as it was, and says why. A merge git refused to start has nothing to abort.
export async function startMerge($: EngineInterface, cwd: string, branch: string): Promise<string | undefined> {
  const merged = await git($, cwd, ['merge', '--no-ff', '--no-commit', branch])
  if (merged.exitCode === 0) return undefined
  const reason = `git could not merge ${branch}: ${(merged.stdout + merged.stderr).trim()}`
  if (await isMerging($, cwd)) await abortMerge($, cwd)
  return reason
}

export async function abortMerge($: EngineInterface, cwd: string): Promise<void> {
  const aborted = await git($, cwd, ['merge', '--abort'])
  if (aborted.exitCode !== 0) throw new Error(`git could not abort the merge in ${cwd}: ${aborted.stderr.trim()}`)
}

export async function commitMerge($: EngineInterface, cwd: string, file: string, message: string): Promise<string | undefined> {
  const added = await git($, cwd, ['add', '--', file])
  if (added.exitCode !== 0) return `git could not add ${file}: ${added.stderr.trim()}`
  const committed = await git($, cwd, ['commit', '-m', message])
  return committed.exitCode === 0 ? undefined : `git could not commit the merge: ${(committed.stdout + committed.stderr).trim()}`
}

// Never forced: git refuses a worktree with changes, and `-d` refuses a branch its HEAD does not contain.
export async function removeWorktree($: EngineInterface, cwd: string, path: string): Promise<string | undefined> {
  const removed = await git($, cwd, ['worktree', 'remove', path])
  return removed.exitCode === 0 ? undefined : `git could not remove the worktree ${path}: ${removed.stderr.trim()}`
}

export async function deleteMergedBranch($: EngineInterface, cwd: string, branch: string): Promise<string | undefined> {
  const deleted = await git($, cwd, ['branch', '-d', branch])
  return deleted.exitCode === 0 ? undefined : `git could not delete the branch ${branch}: ${deleted.stderr.trim()}`
}

export async function isMergedInto($: EngineInterface, cwd: string, branch: string, into: string): Promise<boolean> {
  const ancestor = await git($, cwd, ['merge-base', '--is-ancestor', `refs/heads/${branch}`, `refs/heads/${into}`])
  return ancestor.exitCode === 0
}

export async function defaultBranch($: EngineInterface, repo: Repo): Promise<string | undefined> {
  const remote = await git($, repo.root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  if (remote.exitCode === 0 && remote.stdout.trim().length > 0) return remote.stdout.trim()
  for (const candidate of ['main', 'master']) {
    const found = await git($, repo.root, ['rev-parse', '--verify', '--quiet', candidate])
    if (found.exitCode === 0) return candidate
  }
  return undefined
}

export function relativeTo(root: string, path: string): string | undefined {
  if (path === root) return ''
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : undefined
}

export { lines }
