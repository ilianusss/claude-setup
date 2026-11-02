import type { Commands, Config, PackageConfig } from './config'

const SAFE_PATH = /^[A-Za-z0-9_./@%+=:,-]+$/
const SHELL_OPERATOR = /[|;&<>`$]/
const FILES = '{files}'

export function quote(path: string): string {
  return SAFE_PATH.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`
}

function packageFor(config: Config, file: string): PackageConfig | undefined {
  return config.packages
    .filter(entry => file === entry.path || file.startsWith(`${entry.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

function command(config: Config, file: string, name: keyof Commands): string | undefined {
  return packageFor(config, file)?.commands[name] ?? config.commands[name]
}

export function testFilesCommands(config: Config, files: readonly string[]): string[] {
  const groups = new Map<string, string[]>()
  for (const file of [...files].sort()) {
    const template = command(config, file, 'testFiles') ?? config.commands.test
    groups.set(template, [...(groups.get(template) ?? []), file])
  }
  return [...groups].map(([template, grouped]) =>
    template.includes(FILES) ? template.replace(FILES, grouped.map(quote).join(' ')) : template,
  )
}

export function checksFor(config: Config, sliceFiles: readonly string[]): string[] {
  const perFile = (name: 'lint' | 'typecheck') =>
    sliceFiles.map(file => command(config, file, name)).filter((found): found is string => found !== undefined)
  const all = [
    ...testFilesCommands(config, sliceFiles),
    ...perFile('lint'),
    config.commands.lint,
    ...perFile('typecheck'),
    config.commands.typecheck,
    config.commands.test,
  ].filter((found): found is string => found !== undefined)
  return [...new Set(all)]
}

function matchesTemplate(template: string, ran: string): boolean {
  const [prefix = '', suffix = ''] = template.split(FILES)
  if (!ran.startsWith(prefix) || !ran.endsWith(suffix) || ran.length <= prefix.length + suffix.length) return false
  return !SHELL_OPERATOR.test(ran.slice(prefix.length, ran.length - suffix.length))
}

export function isWatched(config: Config, ran: string): boolean {
  const templates = [config.commands, ...config.packages.map(entry => entry.commands)]
    .flatMap(commands => [commands.test, commands.testFiles, commands.lint, commands.typecheck, commands.e2e])
    .filter((template): template is string => template !== undefined)
  const trimmed = ran.trim()
  return templates.some(template => (template.includes(FILES) ? matchesTemplate(template, trimmed) : template === trimmed))
}
