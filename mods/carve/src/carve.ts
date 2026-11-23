import type { On, SessionMessage } from 'claude-code'

const FOLDER = '.claude/carve'

type Turn = { role: SessionMessage['role']; text: string }

export function registerCarve(on: On): void {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'carve', description: 'Save this conversation as markdown in .claude/carve' })
    return started
  })

  on('command.run', { command: 'carve' }, async $ => {
    const turns = toTurns(await $.session.messages())
    if (turns.length === 0) return { text: 'Nothing to save yet.' }
    const now = new Date(await $.clock.now())
    const folder = `${await $.session.cwd()}/${FOLDER}`
    const file = `${folder}/${fileStamp(now)}.md`
    // The folder ignores itself, so the transcripts stay out of git whatever the repo's .gitignore says.
    await $.fs.write(`${folder}/.gitignore`, '*\n')
    await $.fs.write(file, toMarkdown(turns, now))
    return { text: `Conversation saved to ${file}` }
  })
}

// Keeps the person's prompts and Claude's text; a tool result is a user message with no text, and one answer split around tool calls becomes one turn.
function toTurns(messages: readonly SessionMessage[]): Turn[] {
  const turns: Turn[] = []
  for (const { role, text } of messages) {
    const trimmed = text.trim()
    if (trimmed === '') continue
    const last = turns.at(-1)
    if (role === 'assistant' && last?.role === 'assistant') last.text += `\n\n${trimmed}`
    else turns.push({ role, text: trimmed })
  }
  return turns
}

function toMarkdown(turns: readonly Turn[], now: Date): string {
  const sections = turns.map(({ role, text }) => `## ${role === 'user' ? 'You' : 'Claude'}\n\n${text}\n`)
  return [`# Conversation, ${day(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}\n`, ...sections].join('\n')
}

function fileStamp(now: Date): string {
  return `${day(now)}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function day(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
