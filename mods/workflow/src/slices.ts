export type Slice = { number: number; name: string; done: boolean; text: string; designSections: string[] }

const SLICE_HEADING = /^## Slice (\d+):\s*(.+?)\s*$/
const DONE = /^- \[[xX]\]/
const DESIGN = /^Design:\s*(.+)$/

export function parseSlices(markdown: string): Slice[] {
  const slices: Slice[] = []
  let lines: string[] = []
  let current: Omit<Slice, 'text'> | undefined
  const close = () => {
    if (current !== undefined) slices.push({ ...current, text: lines.join('\n').trim() })
  }
  for (const line of markdown.split('\n')) {
    const heading = SLICE_HEADING.exec(line)
    if (heading !== null) {
      close()
      current = { number: Number(heading[1]), name: heading[2] ?? '', done: false, designSections: [] }
      lines = [line]
      continue
    }
    if (current === undefined) continue
    lines.push(line)
    if (DONE.test(line.trim())) current.done = true
    const design = DESIGN.exec(line.trim())
    if (design !== null) {
      current.designSections = (design[1] ?? '')
        .split(',')
        .map(name => name.trim())
        .filter(name => name.length > 0 && name.toLowerCase() !== 'none')
    }
  }
  close()
  return slices
}

export function sections(markdown: string, names: readonly string[]): string {
  const wanted = new Set(names.map(name => name.toLowerCase()))
  const found: string[][] = []
  let current: string[] | undefined
  for (const line of markdown.split('\n')) {
    if (line.startsWith('# ') || line.startsWith('## ')) {
      current = line.startsWith('## ') && wanted.has(line.slice(3).trim().toLowerCase()) ? [] : undefined
      if (current !== undefined) found.push(current)
    }
    current?.push(line)
  }
  return found.map(lines => lines.join('\n').trim()).join('\n\n')
}
