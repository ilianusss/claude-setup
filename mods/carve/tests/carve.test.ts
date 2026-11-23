import type { On, SessionMessage } from 'claude-code'
import { describe, expect, test, type TestBody } from 'claude-code/testing'

const CWD = '/repo'
// 2026-11-23 14:05:09 in the test's local time zone.
const NOW = new Date(2026, 10, 23, 14, 5, 9).getTime()
const FILE = `${CWD}/.claude/carve/2026-11-23-140509.md`

type Engine = { written: () => Map<string, string> }

function engineBeneath(on: On, messages: SessionMessage[]): Engine {
  const written = new Map<string, string>()
  on('session.cwd', () => ({ value: CWD }))
  on('session.messages', () => ({ value: messages }))
  on('clock.now', () => ({ value: NOW }))
  on('fs.write', (_, e) => {
    written.set(e.path, e.text)
    return { value: undefined }
  })
  return { written: () => written }
}

function user(text: string): SessionMessage {
  return { role: 'user', text, toolUses: [] }
}

function claude(text: string): SessionMessage {
  return { role: 'assistant', text, toolUses: [] }
}

function toolResult(): SessionMessage {
  return { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'ok', isError: false }] }
}

function carve($: Parameters<TestBody>[0]) {
  return $.command.run({ command: 'carve', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
}

describe('/carve', () => {
  test('saves the prompts and the answers in order, as markdown', async ($, on) => {
    const engine = engineBeneath(on, [user('why does the login fail'), claude('The token expired.'), user('fix it'), claude('Done.')])
    await carve($)
    expect(engine.written().get(FILE)).toBe(
      [
        '# Conversation, 2026-11-23 14:05',
        '',
        '## You',
        '',
        'why does the login fail',
        '',
        '## Claude',
        '',
        'The token expired.',
        '',
        '## You',
        '',
        'fix it',
        '',
        '## Claude',
        '',
        'Done.',
        '',
      ].join('\n'),
    )
  })

  test('leaves out tool results and joins the answer split around tool calls', async ($, on) => {
    const engine = engineBeneath(on, [user('fix it'), claude('Looking.'), toolResult(), claude(''), toolResult(), claude('Done.')])
    await carve($)
    expect(engine.written().get(FILE)).toBe(['# Conversation, 2026-11-23 14:05', '', '## You', '', 'fix it', '', '## Claude', '', 'Looking.', '', 'Done.', ''].join('\n'))
  })

  test('keeps its folder out of git', async ($, on) => {
    const engine = engineBeneath(on, [user('hi'), claude('Hello.')])
    await carve($)
    expect(engine.written().get(`${CWD}/.claude/carve/.gitignore`)).toBe('*\n')
  })

  test('names the file it wrote', async ($, on) => {
    engineBeneath(on, [user('hi'), claude('Hello.')])
    const ran = await carve($)
    expect(ran.text).toBe(`Conversation saved to ${FILE}`)
  })

  test('writes nothing when no prompt has been sent', async ($, on) => {
    const engine = engineBeneath(on, [])
    const ran = await carve($)
    expect(engine.written().size).toBe(0)
    expect(ran.text).toBe('Nothing to save yet.')
  })
})
