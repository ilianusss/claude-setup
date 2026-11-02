const SEPARATORS = ['&&', '||', ';', '|', '&', '\n']

function isQuote(char: string | undefined): char is '"' | "'" {
  return char === '"' || char === "'"
}

export function segments(command: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: string | undefined
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? ''
    if (quote !== undefined) {
      current += char
      if (char === quote) quote = undefined
      continue
    }
    if (isQuote(char)) {
      quote = char
      current += char
      continue
    }
    const separator = SEPARATORS.find(candidate => command.startsWith(candidate, index))
    if (separator !== undefined) {
      parts.push(current)
      current = ''
      index += separator.length - 1
      continue
    }
    current += char
  }
  parts.push(current)
  return parts.map(part => part.trim()).filter(part => part.length > 0)
}

export function tokenize(segment: string): string[] {
  const tokens: string[] = []
  let current = ''
  let hasToken = false
  let quote: string | undefined
  for (const char of segment) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (isQuote(char)) {
      quote = char
      hasToken = true
      continue
    }
    if (/\s/.test(char)) {
      if (hasToken) tokens.push(current)
      current = ''
      hasToken = false
      continue
    }
    current += char
    hasToken = true
  }
  if (hasToken) tokens.push(current)
  return tokens
}
