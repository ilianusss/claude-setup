import { describe, expect, mock, test } from 'claude-code/testing'

import { engineBeneath } from './engine'

const DASH = String.fromCharCode(0x2014)

describe('file edits', () => {
  test('an Edit that adds an em dash is refused', async ($, on) => {
    engineBeneath(on)
    const ran = await $.tool.call({ tool: 'Edit', file_path: '/w/a.md', old_string: 'a', new_string: `a ${DASH} b` })
    expect(ran.deny).toContain('em dash')
  })

  test('an Edit that keeps an existing em dash goes through', async ($, on) => {
    engineBeneath(on)
    const ran = await $.tool.call({ tool: 'Edit', file_path: '/w/a.md', old_string: `x ${DASH} y`, new_string: `x ${DASH} y, z` })
    expect(ran.deny).toBeUndefined()
  })

  test('a Write of a new file with an em dash is refused', async ($, on) => {
    engineBeneath(on)
    const ran = await $.tool.call({ tool: 'Write', file_path: '/w/new.md', content: `a${DASH}b` })
    expect(ran.deny).toContain('em dash')
  })

  test('a Write that keeps the em dashes the file already had goes through', async ($, on) => {
    engineBeneath(on, { files: { '/w/old.md': `old ${DASH} text` } })
    const ran = await $.tool.call({ tool: 'Write', file_path: '/w/old.md', content: `old ${DASH} text, more` })
    expect(ran.deny).toBeUndefined()
  })
  test('a notebook cell written with an em dash is refused', async ($, on) => {
    engineBeneath(on)
    const ran = await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/w/a.ipynb', new_source: `x ${DASH} y` })
    expect(ran.deny).toContain('em dash')
  })
})

describe('commit messages and GitHub text', () => {
  test('a git commit whose message has an em dash is refused', async ($, on) => {
    engineBeneath(on)
    const ran = await $.tool.call({ tool: 'Bash', command: `git commit -m "fix: a ${DASH} b"` })
    expect(ran.deny).toContain('em dash')
  })

  test('a gh pr create whose body file has an em dash is refused', async ($, on) => {
    engineBeneath(on, { files: { '/tmp/body.md': `## What\n\nx ${DASH} y` } })
    const ran = await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "feat: x" --body-file /tmp/body.md' })
    expect(ran.deny).toContain('em dash')
  })

  test('another command that merely mentions an em dash goes through', async ($, on) => {
    engineBeneath(on)
    const ran = await $.tool.call({ tool: 'Bash', command: `grep -rn "${DASH}" docs` })
    expect(ran.deny).toBeUndefined()
  })
})

describe('replies', () => {
  test('an em dash in a reply is stored as a spaced hyphen', async ($, on) => {
    engineBeneath(on)
    const session = mock.session(on)
    await $.session.append({
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: `done ${DASH} all green` }] },
      door: 'response',
      origin: { kind: 'model', model: 'claude-opus-5-5' },
      uuid: 'u1',
    })
    expect(session.appended()[0]?.message.content[0]).toMatchObject({ type: 'text', text: 'done - all green' })
  })

  test('a tool result keeps its em dashes', async ($, on) => {
    engineBeneath(on)
    const session = mock.session(on)
    await $.session.append({
      message: { type: 'user', role: 'user', content: [{ type: 'text', text: `clean ${DASH} nothing to commit` }] },
      door: 'tool-result',
      origin: { kind: 'tool', tool: 'Bash' },
      uuid: 'u2',
    })
    expect(session.appended()[0]?.message.content).toEqual([{ type: 'text', text: `clean ${DASH} nothing to commit` }])
  })
})
