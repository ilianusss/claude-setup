import type { EngineInterface, On } from 'claude-code'

import { tokenize } from './shell'

const EM_DASH = String.fromCharCode(0x2014)
const EM_DASH_WITH_SPACES = new RegExp(`[ \t]*${EM_DASH}[ \t]*`, 'g')
const WRITES_PROSE = /\b(?:git\s+(?:-\S+\s+)*commit|gh\s+(?:pr|issue|release)\s+(?:create|edit|comment))\b/
const MESSAGE_FILE_FLAGS = new Set(['-F', '--file', '--body-file'])
const ADVICE = 'Use a hyphen, comma, colon or parentheses instead (CLAUDE.md, Writing).'

export function countEmDashes(text: string): number {
  return text.split(EM_DASH).length - 1
}

export function addedEmDashes(before: string, after: string): number {
  return Math.max(0, countEmDashes(after) - countEmDashes(before))
}

export function rewriteEmDashes(text: string): string {
  return text.replace(EM_DASH_WITH_SPACES, (match, offset: number) => {
    const end = offset + match.length
    return end === text.length || text[end] === '\n' ? ' -' : ' - '
  })
}

export function writesProse(command: string): boolean {
  return WRITES_PROSE.test(command)
}

export function messageFiles(command: string): string[] {
  const tokens = tokenize(command)
  const files: string[] = []
  tokens.forEach((token, index) => {
    const [flag, inline] = token.split('=', 2)
    if (flag === undefined || !MESSAGE_FILE_FLAGS.has(flag)) return
    const file = inline ?? tokens[index + 1]
    if (file !== undefined && file !== '-') files.push(file)
  })
  return files
}

async function readOrEmpty($: EngineInterface, path: string): Promise<string> {
  try {
    return await $.fs.read(path)
  } catch {
    return ''
  }
}

function refusal(added: number): { deny: string } {
  return { deny: `warden: this adds ${added} em dash${added === 1 ? '' : 'es'}. ${ADVICE}` }
}

function checkFailed(what: string): { deny: string } {
  return { deny: `warden: the em dash check on ${what} failed, so the call is refused.` }
}

export function registerTypography(on: On): void {
  on('tool.call', { tool: 'Edit' }, ($, e, next) => {
    const added = addedEmDashes(e.old_string, e.new_string)
    return added > 0 ? refusal(added) : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : checkFailed('an Edit')))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const added = addedEmDashes(await readOrEmpty($, e.file_path), e.content)
    return added > 0 ? refusal(added) : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : checkFailed('a Write')))

  on('tool.call', { tool: 'NotebookEdit' }, ($, e, next) => {
    const added = e.edit_mode === 'delete' ? 0 : countEmDashes(e.new_source)
    return added > 0 ? refusal(added) : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : checkFailed('a notebook edit')))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!writesProse(e.command)) return next(e)
    let added = countEmDashes(e.command)
    for (const file of messageFiles(e.command)) added += countEmDashes(await readOrEmpty($, file))
    return added > 0 ? refusal(added) : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : checkFailed('a commit or GitHub message')))

  on('session.append', { door: 'response' }, ($, e, next) => {
    if (e.origin.kind !== 'model') return next(e)
    const content = e.message.content.map(block =>
      block.type === 'text' && typeof block.text === 'string' ? { ...block, text: rewriteEmDashes(block.text) } : block,
    )
    return next({ ...e, message: { ...e.message, content } })
  })
}
