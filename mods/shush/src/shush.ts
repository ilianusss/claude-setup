import type { On, PromptOrigin, PromptSubmitInput } from 'claude-code'

export const RULES = `shush: how to write your reply to this prompt.
These rules apply only to the reply addressed to the user. Agent prompts, files, commits, PR bodies and handoffs keep their full prose.
- Answer first: the result or verdict in the first sentence, then the reason, then the next step if any.
- No preamble, no restating the question, no closing recap.
- No menu of follow-up offers: at most one question or offer per topic, only when the next step needs the user.
- A tiny task gets a one-line report.
- One idea per sentence, 25 words at most, active voice.
- When a shorter phrasing would be less clear, use plain prose.
- No hedging filler ("it seems", "basically", "just to be clear"). State real uncertainty plainly.
- Never drop not, never, no or only. Keep numbers and units exact. Copy code, commands, paths and error messages exactly.
- Always keep caveats: what was not verified, assumptions, failing tests.
- Write full prose for security warnings, irreversible or destructive actions, design, trade-offs, reviews and workflow phases, when the user asks for detail, and when the user seems confused or asks again.
- For a short answer, prefer prose and short lists to tables and headings.
- Never use an em dash.`

// Spaced so that a prompt ending in C++ keeps the rules.
const FULL_DETAIL_SUFFIX = /\s+\+\+\s*$/
const IS_OFF = { plugin: 'shush', key: 'isOff' } as const
const OFF_STATUS = 'shush: off'
const USAGE = 'Usage: /shush off, /shush on, or /shush alone to switch. End a single prompt with ++ for a full answer.'

export function registerShush(on: On): void {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'shush', description: 'Turn the short-answer rules off or back on for this session', argumentHint: 'off | on' })
    const { value: isOff = false } = await $.state.get(IS_OFF)
    if (isOff) $.ui.status(OFF_STATUS)
    return started
  })

  on('command.run', { command: 'shush' }, async ($, e) => {
    if (!isPerson(e.origin)) return { text: '/shush only obeys a command typed at the prompt.' }
    const { value: wasOff = false } = await $.state.get(IS_OFF)
    const arg = e.args.trim()
    if (arg !== '' && arg !== 'off' && arg !== 'on') return { text: USAGE }
    const isOff = arg === '' ? !wasOff : arg === 'off'
    await $.state.set(IS_OFF, isOff)
    $.ui.status(isOff ? OFF_STATUS : undefined)
    return { text: isOff ? 'Shush is off for this session: replies follow CLAUDE.md alone.' : 'Shush rules are back on.' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isTypedByPerson(e)) return next(e)
    if (FULL_DETAIL_SUFFIX.test(e.text)) return next({ ...e, text: e.text.replace(FULL_DETAIL_SUFFIX, '') })
    const { value: isOff = false } = await $.state.get(IS_OFF)
    if (isOff) return next(e)
    return next({ ...e, context: [...(e.context ?? []), RULES] })
  })
}

function isTypedByPerson(e: PromptSubmitInput): boolean {
  return isPerson(e.origin) && e.command === undefined && e.isMeta === undefined
}

function isPerson(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge'
}
