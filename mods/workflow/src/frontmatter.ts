export type FrontmatterValue = string | readonly string[]
export type Frontmatter = Record<string, FrontmatterValue>

const BLOCK = /^---\n([\s\S]*?)\n---\n?/
const PLAIN_SCALAR = /^[^"[\s](?:.*\S)?$/
const PLAIN_ITEM = /^[^"[\s,](?:[^,]*[^\s,])?$/

function parseScalar(raw: string): string {
  return raw.startsWith('"') ? String(JSON.parse(raw)) : raw
}

function parseValue(raw: string): FrontmatterValue {
  if (!raw.startsWith('[') || !raw.endsWith(']')) return parseScalar(raw)
  const items: string[] = []
  let current = ''
  let inQuotes = false
  for (const char of raw.slice(1, -1)) {
    if (char === '"') inQuotes = !inQuotes
    if (char === ',' && !inQuotes) {
      items.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  items.push(current.trim())
  return items.filter(item => item.length > 0).map(parseScalar)
}

export function parseFrontmatter(text: string): { data: Frontmatter; body: string } {
  const match = BLOCK.exec(text)
  if (match === null) throw new Error('the file has no frontmatter block')
  const data: Frontmatter = {}
  for (const line of (match[1] ?? '').split('\n')) {
    if (line.trim().length === 0) continue
    const colon = line.indexOf(':')
    if (colon < 1) throw new Error(`frontmatter line without a key: ${line}`)
    data[line.slice(0, colon).trim()] = parseValue(line.slice(colon + 1).trim())
  }
  return { data, body: text.slice(match[0].length) }
}

function renderScalar(value: string, plain: RegExp): string {
  return value === '' || plain.test(value) ? value : JSON.stringify(value)
}

export function renderFrontmatter(data: Frontmatter, body: string): string {
  const lines = Object.entries(data).map(([key, value]) =>
    typeof value === 'string'
      ? `${key}: ${renderScalar(value, PLAIN_SCALAR)}`
      : `${key}: [${value.map(item => renderScalar(item, PLAIN_ITEM)).join(', ')}]`,
  )
  return `---\n${lines.join('\n')}\n---\n${body}`
}
