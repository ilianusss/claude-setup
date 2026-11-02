// The workflow mod has its own copy: the two mods ship separately and share no code.

const compiled = new Map<string, RegExp>()

function escape(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] ?? ''
    if (char === '*' && glob[index + 1] === '*') {
      const isDirectoryPrefix = glob[index + 2] === '/'
      source += isDirectoryPrefix ? '(?:.*/)?' : '.*'
      index += isDirectoryPrefix ? 2 : 1
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else if (char === '{' && glob.indexOf('}', index) > index) {
      const end = glob.indexOf('}', index)
      source += `(?:${glob.slice(index + 1, end).split(',').map(escape).join('|')})`
      index = end
    } else {
      source += escape(char)
    }
  }
  return new RegExp(`^${source}$`)
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some(glob => {
    let pattern = compiled.get(glob)
    if (pattern === undefined) {
      pattern = globToRegExp(glob)
      compiled.set(glob, pattern)
    }
    return pattern.test(path)
  })
}
