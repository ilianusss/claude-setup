import type { PromptSubmitInput } from 'claude-code'

const MIN_WORDS = 3
// Longer prompts are mostly pasted logs or code, where a fix does harm.
const MAX_PROMPT_LENGTH = 2000
const MAX_CHANGES_LENGTH = 80
// A fix moves the length a little; an answer or a rewrite moves it a lot.
const MAX_LENGTH_CHANGE = 0.25
const EM_DASH = String.fromCharCode(0x2014)
const PROTECTED_SPAN = /```[\s\S]*?```|`[^`\n]+`|[^\s`]*[/~@][^\s`]*/g
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/

type Run = { removed: string[]; added: string[] }

export function isWorthCorrecting(e: PromptSubmitInput): boolean {
  const isTypedByPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
  return (
    isTypedByPerson &&
    e.command === undefined &&
    e.isMeta === undefined &&
    words(e.text).length >= MIN_WORDS &&
    e.text.length < MAX_PROMPT_LENGTH
  )
}

export function isSafeCorrection(original: string, corrected: string): boolean {
  const lengthChange = Math.abs(corrected.length - original.length) / original.length
  return (
    corrected.trim() !== '' &&
    lengthChange <= MAX_LENGTH_CHANGE &&
    protectedSpans(original).every(span => corrected.includes(span)) &&
    countEmDashes(corrected) <= countEmDashes(original)
  )
}

function protectedSpans(text: string): string[] {
  return [...text.matchAll(PROTECTED_SPAN)].map(([span]) => span.replace(TRAILING_PUNCTUATION, ''))
}

function countEmDashes(text: string): number {
  return text.split(EM_DASH).length - 1
}

export function describeChanges(original: string, corrected: string): string {
  const changes = changedRuns(words(original), words(corrected)).map(describeRun).join(', ')
  return changes.length > MAX_CHANGES_LENGTH ? `${changes.slice(0, MAX_CHANGES_LENGTH - 1)}…` : changes
}

function describeRun({ removed, added }: Run): string {
  if (added.length === 0) return `-${removed.join(' ')}`
  if (removed.length === 0) return `+${added.join(' ')}`
  return `${removed.join(' ')} → ${added.join(' ')}`
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(word => word !== '')
}

function changedRuns(before: string[], after: string[]): Run[] {
  const width = after.length + 1
  const common = new Array<number>((before.length + 1) * width).fill(0)
  const commonAfter = (i: number, j: number) => common[i * width + j] ?? 0
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      common[i * width + j] = before[i] === after[j] ? commonAfter(i + 1, j + 1) + 1 : Math.max(commonAfter(i + 1, j), commonAfter(i, j + 1))
    }
  }

  const runs: Run[] = []
  let run: Run = { removed: [], added: [] }
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    const removedWord = before[i]
    const addedWord = after[j]
    if (removedWord !== undefined && removedWord === addedWord) {
      if (run.removed.length + run.added.length > 0) runs.push(run)
      run = { removed: [], added: [] }
      i++
      j++
    } else if (removedWord !== undefined && (addedWord === undefined || commonAfter(i + 1, j) >= commonAfter(i, j + 1))) {
      run.removed.push(removedWord)
      i++
    } else if (addedWord !== undefined) {
      run.added.push(addedWord)
      j++
    }
  }
  if (run.removed.length + run.added.length > 0) runs.push(run)
  return runs
}
