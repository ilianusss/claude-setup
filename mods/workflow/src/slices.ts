export type Slice = {
  number: number
  name: string
  done: boolean
  text: string
  designSections: string[]
  dependsOn: number[]
  unreadDependencies: string[]
  // False when the slice has no `Depends on:` line, which is not the same as `Depends on: none`.
  declaresDependencies: boolean
}

const SLICE_HEADING = /^## Slice (\d+):\s*(.+?)\s*$/
const DONE = /^- \[[xX]\]/
const DESIGN = /^Design:\s*(.+)$/
const DEPENDS_ON = /^Depends on:\s*(.+)$/i
const DEPENDENCY = /^(?:slice\s+)?(\d+)$/i

function readDependencies(line: string): Pick<Slice, 'dependsOn' | 'unreadDependencies' | 'declaresDependencies'> {
  const entries = line
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0 && entry.toLowerCase() !== 'none')
  const numbers = entries.map(entry => DEPENDENCY.exec(entry)?.[1])
  return {
    dependsOn: numbers.filter((number): number is string => number !== undefined).map(Number),
    unreadDependencies: entries.filter((_, index) => numbers[index] === undefined),
    declaresDependencies: true,
  }
}

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
      current = {
        number: Number(heading[1]),
        name: heading[2] ?? '',
        done: false,
        designSections: [],
        dependsOn: [],
        unreadDependencies: [],
        declaresDependencies: false,
      }
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
    const depends = DEPENDS_ON.exec(line.trim())
    if (depends !== null) Object.assign(current, readDependencies(depends[1] ?? ''))
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

export type Waves = { waves: number[][] } | { errors: string[] }

export function waves(slices: readonly Slice[]): Waves {
  const numbers = new Set(slices.map(slice => slice.number))
  const errors: string[] = []
  const needs = new Map<number, number[]>()
  for (const slice of slices) {
    const valid: number[] = []
    if (!slice.declaresDependencies) errors.push(`slice ${slice.number} has no Depends on line: write the slices it needs, or none`)
    for (const entry of slice.unreadDependencies) {
      errors.push(`slice ${slice.number} depends on "${entry}", which is not a slice number (write "Slice N" or "none")`)
    }
    for (const dependency of slice.dependsOn) {
      if (dependency === slice.number) errors.push(`slice ${slice.number} depends on itself`)
      else if (!numbers.has(dependency)) errors.push(`slice ${slice.number} depends on slice ${dependency}, which does not exist`)
      else valid.push(dependency)
    }
    needs.set(slice.number, valid)
  }
  const placed = new Set<number>()
  const levels: number[][] = []
  let remaining = slices.map(slice => slice.number)
  while (remaining.length > 0) {
    const level = remaining.filter(number => (needs.get(number) ?? []).every(dependency => placed.has(dependency)))
    if (level.length === 0) break
    for (const number of level) placed.add(number)
    levels.push(level)
    remaining = remaining.filter(number => !placed.has(number))
  }
  errors.push(...cyclesAmong(remaining, needs))
  return errors.length > 0 ? { errors } : { waves: levels }
}

function cyclesAmong(stuck: readonly number[], needs: ReadonlyMap<number, number[]>): string[] {
  const reported = new Set<number>()
  const errors: string[] = []
  for (const start of stuck) {
    const path: number[] = []
    let node: number | undefined = start
    while (node !== undefined && !reported.has(node) && !path.includes(node)) {
      path.push(node)
      node = (needs.get(node) ?? []).find(dependency => stuck.includes(dependency))
    }
    if (node !== undefined && path.includes(node)) {
      const cycle = path.slice(path.indexOf(node))
      const first = cycle.indexOf(Math.min(...cycle))
      const ordered = [...cycle.slice(first), ...cycle.slice(0, first)]
      errors.push(`slices ${[...ordered, ordered[0]].join(' -> ')} depend on each other in a cycle`)
    }
    for (const visited of path) reported.add(visited)
  }
  return errors
}

// A slice whose dependencies are unclear never starts: the gate refuses them, and slices.md may change after it.
export function isReady(slice: Slice, done: ReadonlySet<number>): boolean {
  return (
    !slice.done &&
    slice.declaresDependencies &&
    slice.unreadDependencies.length === 0 &&
    slice.dependsOn.every(dependency => done.has(dependency))
  )
}

export function doneSlices(slices: readonly Slice[]): Set<number> {
  return new Set(slices.filter(slice => slice.done).map(slice => slice.number))
}

export function readySlices(slices: readonly Slice[], running: readonly number[], max: number): Slice[] {
  const done = doneSlices(slices)
  return slices.filter(slice => !running.includes(slice.number) && isReady(slice, done)).slice(0, Math.max(max, 0))
}

const OPEN_DONE = /^(\s*)- \[ \](?= Done\b)/

export function tickSlice(markdown: string, number: number): string | undefined {
  const lines = markdown.split('\n')
  let inSlice = false
  for (const [index, line] of lines.entries()) {
    const heading = SLICE_HEADING.exec(line)
    if (heading !== null) inSlice = Number(heading[1]) === number
    else if (line.startsWith('## ')) inSlice = false
    if (!inSlice || !OPEN_DONE.test(line)) continue
    lines[index] = line.replace(OPEN_DONE, '$1- [x]')
    return lines.join('\n')
  }
  return undefined
}
