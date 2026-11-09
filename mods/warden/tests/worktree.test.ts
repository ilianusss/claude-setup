import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { CHOICES } from '../src/worktree'
import { engineBeneath } from './engine'

const REV_PARSE = 'rev-parse --path-format=absolute --show-toplevel --git-dir --git-common-dir'
const MAIN = '/r\n/r/.git\n/r/.git\n'
const LINKED = '/r/.claude/worktrees/x\n/r/.git/worktrees/x\n/r/.git\n'
const STATUS = 'status --porcelain=v1 -z --untracked-files=all'
const FILES = { '/r/src/a.ts': 'a', '/r/src/b.ts': 'b' }

function edit(file_path: string): { tool: 'Edit'; file_path: string; old_string: string; new_string: string } {
  return { tool: 'Edit', file_path, old_string: 'a', new_string: 'b' }
}

describe('edits in a main checkout', () => {
  test('ask once, and allowing the checkout lets later edits through', async ($, on) => {
    const questions: string[] = []
    engineBeneath(on, { files: FILES, git: { [REV_PARSE]: MAIN }, answers: [CHOICES.allow], questions })

    const first = await $.tool.call(edit('/r/src/a.ts'))
    const second = await $.tool.call(edit('/r/src/b.ts'))

    expect(first.deny).toBeUndefined()
    expect(second.deny).toBeUndefined()
    expect(questions).toHaveLength(1)
    expect(questions[0]).toContain('src/a.ts')
  })

  test('choosing the worktree refuses the edit and points to EnterWorktree', async ($, on) => {
    engineBeneath(on, { files: FILES, git: { [REV_PARSE]: MAIN }, answers: [CHOICES.move] })

    const ran = await $.tool.call(edit('/r/src/a.ts'))

    expect(ran.deny).toContain('EnterWorktree')
  })

  test('a dismissed dialog refuses the edit', async ($, on) => {
    engineBeneath(on, { files: FILES, git: { [REV_PARSE]: MAIN } })

    const ran = await $.tool.call(edit('/r/src/a.ts'))

    expect(ran.deny).toContain('EnterWorktree')
  })

  test('a typed answer refuses the edit and is passed on', async ($, on) => {
    engineBeneath(on, { files: FILES, git: { [REV_PARSE]: MAIN }, answers: ['use the feat/x worktree'] })

    const ran = await $.tool.call(edit('/r/src/a.ts'))

    expect(ran.deny).toContain('use the feat/x worktree')
  })

  test('a Write and a notebook edit are checked too', async ($, on) => {
    engineBeneath(on, { files: { ...FILES, '/r/n.ipynb': '{}' }, git: { [REV_PARSE]: MAIN } })

    const written = await $.tool.call({ tool: 'Write', file_path: '/r/src/c.ts', content: 'c' })
    const notebook = await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/r/n.ipynb', new_source: 'x' })

    expect(written.deny).toContain('EnterWorktree')
    expect(notebook.deny).toContain('EnterWorktree')
  })

  test('a new file in a new folder is looked up from the nearest existing folder', async ($, on) => {
    const cwds: string[] = []
    engineBeneath(on, { files: FILES, git: { [REV_PARSE]: MAIN }, cwds })

    const ran = await $.tool.call({ tool: 'Write', file_path: '/r/src/new/deep/c.ts', content: 'c' })

    expect(ran.deny).toContain('EnterWorktree')
    expect(cwds).toContain('/r/src')
  })

  test('edits sent together open one dialog', async ($, on) => {
    const questions: string[] = []
    engineBeneath(on, { files: FILES, git: { [REV_PARSE]: MAIN }, answers: [CHOICES.allow], questions })

    const ran = await Promise.all([$.tool.call(edit('/r/src/a.ts')), $.tool.call(edit('/r/src/b.ts'))])

    expect(ran.map(result => result.deny)).toEqual([undefined, undefined])
    expect(questions).toHaveLength(1)
  })
})

describe('edits that need no worktree', () => {
  test('an edit in a linked worktree goes through without asking', async ($, on) => {
    const questions: string[] = []
    engineBeneath(on, { files: { '/r/.claude/worktrees/x/a.ts': 'a' }, git: { [REV_PARSE]: LINKED }, questions })

    const ran = await $.tool.call(edit('/r/.claude/worktrees/x/a.ts'))

    expect(ran.deny).toBeUndefined()
    expect(questions).toHaveLength(0)
  })

  test('an ignored file goes through without asking', async ($, on) => {
    const questions: string[] = []
    engineBeneath(on, { files: { '/r/plans/p.md': 'a' }, git: { [REV_PARSE]: MAIN, 'check-ignore -q -- /r/plans/p.md': '' }, questions })

    const ran = await $.tool.call(edit('/r/plans/p.md'))

    expect(ran.deny).toBeUndefined()
    expect(questions).toHaveLength(0)
  })

  test('a file outside any repo goes through without asking', async ($, on) => {
    const questions: string[] = []
    engineBeneath(on, { files: { '/tmp/s/a.md': 'a' }, questions })

    const ran = await $.tool.call(edit('/tmp/s/a.md'))

    expect(ran.deny).toBeUndefined()
    expect(questions).toHaveLength(0)
  })
})

describe('shell commands in a main checkout', () => {
  function setup(on: On, git: Record<string, string>, onBash: (command: string) => void, answers: string[] = []): string[] {
    const questions: string[] = []
    git[REV_PARSE] ??= MAIN
    engineBeneath(on, { files: FILES, git, answers, questions, onBash })
    on('session.cwd', () => ({ value: '/r' }))
    return questions
  }

  function bash(command: string): { tool: 'Bash'; command: string } {
    return { tool: 'Bash', command }
  }

  test('a command that changes a file asks, and the worktree answer adds a note to its result', async ($, on) => {
    const git: Record<string, string> = { [STATUS]: '' }
    const questions = setup(on, git, () => {
      git[STATUS] = ' M src/a.ts\0'
      git['hash-object -- src/a.ts'] = 'h1\n'
    }, [CHOICES.move])

    const ran = await $.tool.call(bash("sed -i '' s/a/b/ src/a.ts"))

    expect(questions[0]).toContain('src/a.ts')
    expect(ran.context?.join('\n')).toContain('src/a.ts')
    expect(ran.context?.join('\n')).toContain('EnterWorktree')
  })

  test('allowing the checkout adds no note and lets later edits through', async ($, on) => {
    const git: Record<string, string> = { [STATUS]: '' }
    const questions = setup(on, git, () => {
      git[STATUS] = '?? src/c.ts\0'
      git['hash-object -- src/c.ts'] = 'h1\n'
    }, [CHOICES.allow])

    const ran = await $.tool.call(bash('touch src/c.ts'))
    const edited = await $.tool.call(edit('/r/src/a.ts'))

    expect(ran.context).toBeUndefined()
    expect(edited.deny).toBeUndefined()
    expect(questions).toHaveLength(1)
    expect(questions[0]).toContain('src/c.ts')
  })

  test('a command that changes nothing asks nothing', async ($, on) => {
    const questions = setup(on, { [STATUS]: ' M src/a.ts\0', 'hash-object -- src/a.ts': 'h1\n' }, () => undefined)

    const ran = await $.tool.call(bash('ls'))

    expect(ran.context).toBeUndefined()
    expect(questions).toHaveLength(0)
  })

  test('a file the person changes between commands is not taken for the command', async ($, on) => {
    const git: Record<string, string> = { [STATUS]: '' }
    const questions = setup(on, git, () => undefined)

    await $.tool.call(bash('ls'))
    git[STATUS] = ' M src/a.ts\0'
    git['hash-object -- src/a.ts'] = 'h1\n'
    await $.tool.call(bash('ls'))

    expect(questions).toHaveLength(0)
  })

  test('a file the person had changed that the command changes again asks', async ($, on) => {
    const git: Record<string, string> = { [STATUS]: ' M src/a.ts\0', 'hash-object -- src/a.ts': 'h1\n' }
    const questions = setup(on, git, () => {
      git['hash-object -- src/a.ts'] = 'h2\n'
    }, [CHOICES.move])

    await $.tool.call(bash('npm run format'))

    expect(questions).toHaveLength(1)
  })

  test('a file the command restores to its committed state asks', async ($, on) => {
    const git: Record<string, string> = { [STATUS]: ' M src/a.ts\0', 'hash-object -- src/a.ts': 'h1\n' }
    const questions = setup(on, git, () => {
      git[STATUS] = ''
    }, [CHOICES.move])

    await $.tool.call(bash('git checkout -- src/a.ts'))

    expect(questions[0]).toContain('src/a.ts')
  })

  test('a session in a linked worktree is not checked', async ($, on) => {
    const git: Record<string, string> = { [REV_PARSE]: LINKED, [STATUS]: '' }
    const questions = setup(on, git, () => {
      git[STATUS] = ' M a.ts\0'
      git['hash-object -- a.ts'] = 'h1\n'
    })

    const ran = await $.tool.call(bash('touch a.ts'))

    expect(ran.context).toBeUndefined()
    expect(questions).toHaveLength(0)
  })
})
