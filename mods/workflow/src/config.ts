export type Commands = {
  test: string
  testFiles?: string
  lint?: string
  typecheck?: string
  format?: string
  e2e?: string
}
export type PackageConfig = { path: string; testGlobs: string[]; commands: Partial<Commands> }
export type Config = {
  testGlobs: string[]
  testConfig: string[]
  commands: Commands
  testLevel: string | undefined
  specsDir: string
  packages: PackageConfig[]
}

const COMMAND_NAMES = ['test', 'testFiles', 'lint', 'typecheck', 'format', 'e2e'] as const
const DEFAULT_SPECS_DIR = 'docs/specs'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function readCommands(value: unknown, where: string, errors: string[]): Partial<Commands> {
  if (value === undefined) return {}
  if (!isRecord(value)) {
    errors.push(`${where} must be an object`)
    return {}
  }
  const commands: Partial<Commands> = {}
  for (const name of COMMAND_NAMES) {
    const command = value[name]
    if (command === undefined) continue
    if (typeof command === 'string') commands[name] = command
    else errors.push(`${where}.${name} must be a string`)
  }
  return commands
}

function readGlobs(value: unknown, where: string, errors: string[]): string[] {
  if (value === undefined) return []
  if (isStringList(value)) return value
  errors.push(`${where} must be a list of globs`)
  return []
}

export function parseConfig(text: string): { config: Config } | { errors: string[] } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { errors: [`.claude/workflow.json is not valid JSON: ${String(error)}`] }
  }
  if (!isRecord(raw)) return { errors: ['.claude/workflow.json must hold an object'] }

  const errors: string[] = []
  if (raw.testGlobs === undefined) errors.push('testGlobs is required')
  const testGlobs = readGlobs(raw.testGlobs, 'testGlobs', errors)
  if (isStringList(raw.testGlobs) && raw.testGlobs.length === 0) errors.push('testGlobs must not be empty')
  if (!isRecord(raw.commands) || raw.commands.test === undefined) errors.push('commands.test is required')
  const commands = readCommands(raw.commands, 'commands', errors)
  const testConfig = readGlobs(raw.testConfig, 'testConfig', errors)
  const specsDir = typeof raw.specsDir === 'string' ? raw.specsDir : DEFAULT_SPECS_DIR
  const testLevel = typeof raw.testLevel === 'string' ? raw.testLevel : undefined

  const packages: PackageConfig[] = []
  if (raw.packages !== undefined && !Array.isArray(raw.packages)) errors.push('packages must be a list')
  for (const [index, entry] of (Array.isArray(raw.packages) ? raw.packages : []).entries()) {
    const where = `packages[${index}]`
    if (!isRecord(entry) || typeof entry.path !== 'string') {
      errors.push(`${where}.path is required`)
      continue
    }
    packages.push({
      path: entry.path.replace(/\/+$/, ''),
      testGlobs: readGlobs(entry.testGlobs, `${where}.testGlobs`, errors),
      commands: readCommands(entry.commands, `${where}.commands`, errors),
    })
  }

  if (errors.length > 0 || commands.test === undefined) return { errors }
  return { config: { testGlobs, testConfig, commands: { ...commands, test: commands.test }, testLevel, specsDir, packages } }
}
