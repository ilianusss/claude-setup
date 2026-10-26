import type { On } from 'claude-code'

import { segments, tokenize } from './shell'

type Check = (args: readonly string[]) => string | undefined

const WRAPPERS = new Set(['sudo', 'command', 'exec', 'time', 'nohup', 'rtk'])
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env'])
const KUBE_OPTIONS_WITH_VALUE = new Set(['-n', '--namespace', '--context', '--kube-context', '--kubeconfig', '--cluster', '--user', '-s', '--server'])

const CONTAINED_IN_SANDBOX = new Set(['rm'])
// The deny rules in settings.json bind a command only inside the sandbox, so outside it a secret path has to ask.
const SECRET_PATH = /\.env\b|\.ssh\b|\.kube\/config|\.aws\/credentials|\.tfstate|\.pem\b|\.key\b/

const DISCARDS = 'can discard uncommitted work'

function words(segment: string): string[] {
  const tokens = tokenize(segment.replace(/^[({]\s*/, '').replace(/\s*[)}]$/, ''))
  let start = 0
  while (start < tokens.length && (ENV_ASSIGNMENT.test(tokens[start] ?? '') || WRAPPERS.has(tokens[start] ?? ''))) {
    start += tokens[start] === 'rtk' && tokens[start + 1] === 'proxy' ? 2 : 1
  }
  const program = tokens[start]?.split('/').pop()
  return program === undefined ? [] : [program, ...tokens.slice(start + 1)]
}

function positional(args: readonly string[], optionsWithValue: ReadonlySet<string>): string[] {
  const found: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (optionsWithValue.has(arg)) index += 1
    else if (!arg.startsWith('-')) found.push(arg)
  }
  return found
}

function shortFlags(args: readonly string[]): string {
  return args.filter(arg => /^-[a-zA-Z]+$/.test(arg)).map(arg => arg.slice(1)).join('')
}

const git: Check = args => {
  let index = 0
  while (index < args.length && (args[index] ?? '').startsWith('-')) {
    index += GIT_OPTIONS_WITH_VALUE.has(args[index] ?? '') ? 2 : 1
  }
  const subcommand = args[index]
  const rest = args.slice(index + 1)
  const flags = shortFlags(rest)
  switch (subcommand) {
    case 'reset':
      return rest.includes('--hard') ? DISCARDS : undefined
    case 'clean':
      return flags.includes('n') || rest.includes('--dry-run') ? undefined : 'deletes untracked files'
    case 'branch': {
      const isDelete = flags.includes('d') || rest.includes('--delete')
      const isForced = flags.includes('D') || flags.includes('f') || rest.includes('--force')
      return flags.includes('D') || (isDelete && isForced) ? 'deletes a branch with unmerged work' : undefined
    }
    default:
      return undefined
  }
}

const rm: Check = args => {
  const flags = shortFlags(args)
  const isRecursive = /[rR]/.test(flags) || args.includes('--recursive')
  const isForced = flags.includes('f') || args.includes('--force')
  return isRecursive && isForced ? 'deletes files recursively without asking' : undefined
}

const terraform: Check = args => {
  const [subcommand, next] = positional(args, new Set())
  if (subcommand === 'apply' || subcommand === 'destroy' || subcommand === 'import') return 'changes infrastructure'
  if (subcommand === 'state' && !['list', 'show', 'pull'].includes(next ?? '')) return 'changes Terraform state'
  return undefined
}

const kubectl: Check = args => {
  const [verb, next] = positional(args, KUBE_OPTIONS_WITH_VALUE)
  if (['apply', 'delete', 'edit', 'patch', 'scale', 'replace', 'drain'].includes(verb ?? '')) return 'changes a cluster'
  if (verb === 'rollout' && !['status', 'history'].includes(next ?? '')) return 'changes a cluster'
  return undefined
}

const helm: Check = args => {
  const [subcommand] = positional(args, KUBE_OPTIONS_WITH_VALUE)
  return ['install', 'upgrade', 'uninstall', 'delete', 'rollback'].includes(subcommand ?? '') ? 'changes a cluster' : undefined
}

const docker: Check = args => {
  const [first, second] = positional(args, new Set())
  if (first === 'system' && second === 'prune') return 'deletes Docker data'
  if (first === 'volume' && (second === 'rm' || second === 'prune')) return 'deletes Docker volumes'
  if (first === 'compose' && second === 'down' && (args.includes('-v') || args.includes('--volumes'))) return 'deletes Docker volumes'
  return undefined
}

const gh: Check = args => {
  const [first, second] = positional(args, new Set(['-R', '--repo']))
  if (first === 'pr' && second === 'merge') return 'merges a pull request'
  if (first === 'release' && !['list', 'view', 'download'].includes(second ?? '')) return 'changes a release'
  if (first === 'repo' && second === 'delete') return 'deletes a repository'
  return undefined
}

const publish: Check = args => (args.includes('publish') ? 'publishes a package' : undefined)

const CHECKS: Readonly<Record<string, Check>> = {
  git,
  rm,
  terraform,
  tofu: terraform,
  kubectl,
  helm,
  docker,
  'docker-compose': args => docker(['compose', ...args]),
  gh,
  npm: publish,
  pnpm: publish,
  yarn: publish,
  cargo: publish,
  dropdb: () => 'drops a database',
}

export function riskyReason(command: string, unsandboxed = false): string | undefined {
  for (const segment of segments(command)) {
    const [program, ...args] = words(segment)
    const isContained = program !== undefined && !unsandboxed && CONTAINED_IN_SANDBOX.has(program)
    const what = program === undefined || isContained ? undefined : CHECKS[program]?.(args)
    if (what !== undefined) return `\`${segment}\` ${what}`
    if (unsandboxed && SECRET_PATH.test(segment)) return `\`${segment}\` touches a secret outside the sandbox`
  }
  return undefined
}

export function registerSafety(on: On): void {
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'deny') return verdict
    const input = (e.input ?? {}) as { command?: unknown; dangerouslyDisableSandbox?: unknown }
    const reason = riskyReason(typeof input.command === 'string' ? input.command : '', input.dangerouslyDisableSandbox === true)
    return reason === undefined ? verdict : { decision: 'ask', reason: `house: ${reason}. Approve only if you asked for it.` }
  }).catch(() => ({ decision: 'ask', reason: 'house: the safety check failed. Approve only if you asked for this command.' }))
}
