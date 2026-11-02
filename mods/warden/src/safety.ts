import type { On } from 'claude-code'

import { segments, tokenize } from './shell'

type Risk = { what: string; isLiftable: boolean }
type Check = (args: readonly string[]) => Risk | undefined

const WRAPPERS = new Set(['sudo', 'command', 'exec', 'time', 'nohup', 'rtk'])
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env'])
const ENV_OPTIONS_WITH_VALUE = new Set(['-u', '--unset', '-C', '--chdir'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash'])
const KUBE_OPTIONS_WITH_VALUE = new Set(['-n', '--namespace', '--context', '--kube-context', '--kubeconfig', '--cluster', '--user', '-s', '--server'])

// The Read deny rules in settings.json do not bind shell commands, so a shell command that names a secret file has to ask.
const SECRET_PATH =
  /(?:^|[\s'"=<>:\/])(?:\.env(?:\.(?!example\b|sample\b|template\b|dist\b)[\w.-]+)?|\.ssh\/\S*|\.kube\/config|\.aws\/credentials|[\w.-]*\.tfstate(?:\.backup)?|[\w.-]+\.(?:pem|key))(?=$|[\s'";|&)<>])/

const DISCARDS = 'can discard uncommitted work'

const SAFETY_OFF = { plugin: 'warden', key: 'isSafetyOff' } as const
const OFF_STATUS = 'warden: safety off'
const OFF_TEXT = [
  'Safety is off for this session: terraform, tofu, kubectl, helm, docker, package publishes and force pushes run without asking.',
  'git discards, rm -rf, gh merges and releases, dropdb and secret files still ask. Run /safety to turn it back on.',
].join(' ')

function asks(what: string): Risk {
  return { what, isLiftable: false }
}

function liftable(what: string): Risk {
  return { what, isLiftable: true }
}

function afterEnvOptions(tokens: readonly string[], start: number): number {
  let index = start
  while (index < tokens.length && (tokens[index] ?? '').startsWith('-')) {
    index += ENV_OPTIONS_WITH_VALUE.has(tokens[index] ?? '') ? 2 : 1
  }
  return index
}

function words(segment: string): string[] {
  const tokens = tokenize(segment.replace(/^[({]\s*/, '').replace(/\s*[)}]$/, ''))
  let start = 0
  while (start < tokens.length) {
    const token = tokens[start] ?? ''
    if (token === 'rtk' && tokens[start + 1] === 'proxy') start += 2
    else if (token === 'env') start = afterEnvOptions(tokens, start + 1)
    else if (ENV_ASSIGNMENT.test(token) || WRAPPERS.has(token)) start += 1
    else break
  }
  const program = tokens[start]?.split('/').pop()
  return program === undefined ? [] : [program, ...tokens.slice(start + 1)]
}

function inlineScript(args: readonly string[]): string | undefined {
  const flag = args.findIndex(arg => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg))
  return flag === -1 ? undefined : args[flag + 1]
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
      return rest.includes('--hard') ? asks(DISCARDS) : undefined
    case 'clean':
      return flags.includes('n') || rest.includes('--dry-run') ? undefined : asks('deletes untracked files')
    case 'push': {
      const isForced =
        flags.includes('f') || rest.some(arg => arg === '--force' || arg.startsWith('--force-with-lease') || arg.startsWith('+'))
      return isForced ? liftable('force-pushes, rewriting the remote history') : undefined
    }
    case 'branch': {
      const isDelete = flags.includes('d') || rest.includes('--delete')
      const isForced = flags.includes('D') || flags.includes('f') || rest.includes('--force')
      return flags.includes('D') || (isDelete && isForced) ? asks('deletes a branch with unmerged work') : undefined
    }
    default:
      return undefined
  }
}

const rm: Check = args => {
  const flags = shortFlags(args)
  const isRecursive = /[rR]/.test(flags) || args.includes('--recursive')
  const isForced = flags.includes('f') || args.includes('--force')
  return isRecursive && isForced ? asks('deletes files recursively without asking') : undefined
}

const terraform: Check = args => {
  const [subcommand, next] = positional(args, new Set())
  if (subcommand === 'apply' || subcommand === 'destroy' || subcommand === 'import') return liftable('changes infrastructure')
  if (subcommand === 'state' && !['list', 'show', 'pull'].includes(next ?? '')) return liftable('changes Terraform state')
  return undefined
}

const kubectl: Check = args => {
  const [verb, next] = positional(args, KUBE_OPTIONS_WITH_VALUE)
  if (['apply', 'delete', 'edit', 'patch', 'scale', 'replace', 'drain'].includes(verb ?? '')) return liftable('changes a cluster')
  if (verb === 'rollout' && !['status', 'history'].includes(next ?? '')) return liftable('changes a cluster')
  return undefined
}

const helm: Check = args => {
  const [subcommand] = positional(args, KUBE_OPTIONS_WITH_VALUE)
  return ['install', 'upgrade', 'uninstall', 'delete', 'rollback'].includes(subcommand ?? '') ? liftable('changes a cluster') : undefined
}

const docker: Check = args => {
  const [first, second] = positional(args, new Set())
  if (first === 'system' && second === 'prune') return liftable('deletes Docker data')
  if (first === 'volume' && (second === 'rm' || second === 'prune')) return liftable('deletes Docker volumes')
  if (first === 'compose' && second === 'down' && (args.includes('-v') || args.includes('--volumes'))) return liftable('deletes Docker volumes')
  return undefined
}

const gh: Check = args => {
  const [first, second] = positional(args, new Set(['-R', '--repo']))
  if (first === 'pr' && second === 'merge') return asks('merges a pull request')
  if (first === 'release' && !['list', 'view', 'download'].includes(second ?? '')) return asks('changes a release')
  if (first === 'repo' && second === 'delete') return asks('deletes a repository')
  return undefined
}

const publish: Check = args => (args.includes('publish') ? liftable('publishes a package') : undefined)

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
  dropdb: () => asks('drops a database'),
}

export function riskyReason(command: string, isSafetyOff = false): string | undefined {
  for (const segment of segments(command)) {
    const [program, ...args] = words(segment)
    const script = program !== undefined && SHELLS.has(program) ? inlineScript(args) : undefined
    const inner = script === undefined ? undefined : riskyReason(script, isSafetyOff)
    if (inner !== undefined) return inner
    const risk = program === undefined ? undefined : CHECKS[program]?.(args)
    if (risk !== undefined && !(isSafetyOff && risk.isLiftable)) return `\`${segment}\` ${risk.what}`
    if (SECRET_PATH.test(segment)) return `\`${segment}\` touches a secret file`
  }
  return undefined
}

export function registerSafety(on: On): void {
  // integrity already hooks session.start without a matcher, and the engine refuses a second such hook.
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'safety', description: 'Turn the warden asks for terraform, kubectl, helm, docker, publishes and force pushes off or back on' })
    const { value: isOff = false } = await $.state.get(SAFETY_OFF)
    if (isOff) $.ui.status(OFF_STATUS)
    return started
  })

  on('command.run', { command: 'safety' }, async ($, e) => {
    if (e.origin.kind !== 'composer') return { text: '/safety only obeys a command typed at the prompt.' }
    const { value: wasOff = false } = await $.state.get(SAFETY_OFF)
    await $.state.set(SAFETY_OFF, !wasOff)
    $.ui.status(wasOff ? undefined : OFF_STATUS)
    return { text: wasOff ? 'Safety asks are back on.' : OFF_TEXT }
  })

  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'deny') return verdict
    const { value: isOff = false } = await $.state.get(SAFETY_OFF)
    const input = (e.input ?? {}) as { command?: unknown }
    const command = typeof input.command === 'string' ? input.command : ''
    const reason = riskyReason(command, isOff)
    return reason === undefined ? verdict : { decision: 'ask', reason: `warden: ${reason}. Approve only if you asked for it.` }
  }).catch(() => ({ decision: 'ask', reason: 'warden: the safety check failed. Approve only if you asked for this command.' }))
}
