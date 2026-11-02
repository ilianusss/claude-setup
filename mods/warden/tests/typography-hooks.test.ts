import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
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

describe('files written through the shell', () => {
  const TOPLEVEL = 'rev-parse --show-toplevel'
  const DIFF = 'diff HEAD -U0 --no-color --no-ext-diff'
  const UNTRACKED = 'ls-files --others --exclude-standard -z'

  function addedLine(file: string, line: string): string {
    return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, '@@ -1,0 +2 @@', `+${line}`, ''].join('\n')
  }

  async function turn($: Engine, id: string, during: () => void): Promise<void> {
    await $.turn.start({ text: 'go', turnId: id })
    during()
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' })
  }

  function listen(on: On): string[] {
    const prompts: string[] = []
    on('session.cwd', () => ({ value: '/r' }))
    on('prompt.submit', (_, e) => {
      prompts.push(e.text)
      return { text: e.text }
    })
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    return prompts
  }

  test('an em dash added to a tracked file during the turn queues one follow-up', async ($, on) => {
    const git: Record<string, string> = { [TOPLEVEL]: '/r\n', [DIFF]: '', [UNTRACKED]: '' }
    engineBeneath(on, { git })
    const clock = mock.clock(on)
    const prompts = listen(on)
    await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })

    await turn($, 't1', () => {
      git[DIFF] = addedLine('docs/usage.md', `parse ${DASH} then format`)
    })
    await clock.settle()
    await turn($, 't2', () => {})
    await clock.settle()

    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('docs/usage.md: 1')
  })

  test('em dashes already there when the turn started are left alone', async ($, on) => {
    const git: Record<string, string> = { [TOPLEVEL]: '/r\n', [DIFF]: addedLine('notes.md', `mine ${DASH} kept`), [UNTRACKED]: '' }
    engineBeneath(on, { git })
    const clock = mock.clock(on)
    const prompts = listen(on)
    await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })

    await turn($, 't1', () => {})
    await clock.settle()

    expect(prompts).toHaveLength(0)
  })

  test('a new untracked file with an em dash queues a follow-up', async ($, on) => {
    const git: Record<string, string> = { [TOPLEVEL]: '/r\n', [DIFF]: '', [UNTRACKED]: '' }
    const files: Record<string, string> = {}
    engineBeneath(on, { git, files })
    const clock = mock.clock(on)
    const prompts = listen(on)
    await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })

    await turn($, 't1', () => {
      git[UNTRACKED] = 'README.md\0'
      files['/r/README.md'] = `# Durations\n\nParse ${DASH} and format.\n`
    })
    await clock.settle()

    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('README.md: 1')
  })
})
