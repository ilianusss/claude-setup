import type { EngineInterface, ProcessRunResult } from 'claude-code'

export type Repo = { root: string; commonDir: string; branch: string }

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
  const paths = await git($, cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])
  if (paths.exitCode !== 0) return undefined
  const [root, commonDir] = lines(paths.stdout)
  if (root === undefined || commonDir === undefined) return undefined
  const head = await git($, root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  return { root, commonDir, branch: head.exitCode === 0 ? head.stdout.trim() : 'HEAD' }
}

export function isDefaultBranch(branch: string): boolean {
  return DEFAULT_BRANCHES.includes(branch)
}

export async function treeHash($: EngineInterface, repo: Repo, indexFile: string): Promise<string> {
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

export async function addWorktree($: EngineInterface, repo: Repo, branch: string, path: string): Promise<void> {
  const added = await git($, repo.root, ['worktree', 'add', '-b', branch, path])
  if (added.exitCode !== 0) throw new Error(`git could not create the worktree: ${added.stderr.trim()}`)
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
