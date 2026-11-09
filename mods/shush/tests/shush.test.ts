import type { On, PromptSubmitInput } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { RULES } from '../src/shush'

type Entered = { text: string; context: readonly string[] }
type Engine = { entered: () => Entered | undefined }

function engineBeneath(on: On): Engine {
  let entered: Entered | undefined
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => {
    entered = { text: e.text, context: e.context ?? [] }
    return { text: e.text, context: e.context }
  })
  return { entered: () => entered }
}

function typed(text: string, extra: Partial<PromptSubmitInput> = {}): PromptSubmitInput {
  return { text, wait: false, origin: { kind: 'composer' }, ...extra }
}

describe('a prompt typed at the composer', () => {
  test('reaches the model as typed, with the rules beside it', async ($, on) => {
    const engine = engineBeneath(on)
    await $.prompt.submit(typed('why does the login fail'))
    expect(engine.entered()).toEqual({ text: 'why does the login fail', context: [RULES] })
  })

  test('keeps the context another hook attached', async ($, on) => {
    const engine = engineBeneath(on)
    await $.prompt.submit(typed('why does the login fail', { context: ['a note'] }))
    expect(engine.entered()?.context).toEqual(['a note', RULES])
  })
})

test('a prompt sent through Remote Control gets the rules', async ($, on) => {
  const engine = engineBeneath(on)
  await $.prompt.submit(typed('why does the login fail', { origin: { kind: 'bridge' } }))
  expect(engine.entered()?.context).toEqual([RULES])
})

describe('a prompt ending in ++', () => {
  test('reaches the model without the ++ and without the rules', async ($, on) => {
    const engine = engineBeneath(on)
    await $.prompt.submit(typed('explain the login flow ++'))
    expect(engine.entered()).toEqual({ text: 'explain the login flow', context: [] })
  })

  test('counts when trailing whitespace follows it', async ($, on) => {
    const engine = engineBeneath(on)
    await $.prompt.submit(typed('explain the login flow ++ \n'))
    expect(engine.entered()).toEqual({ text: 'explain the login flow', context: [] })
  })

  test('does not count when it ends a word like C++', async ($, on) => {
    const engine = engineBeneath(on)
    await $.prompt.submit(typed('should this tool be written in C++'))
    expect(engine.entered()).toEqual({ text: 'should this tool be written in C++', context: [RULES] })
  })
})

describe('a prompt shush leaves alone', () => {
  test('a slash command', async ($, on) => {
    const engine = engineBeneath(on)
    await $.prompt.submit(typed('/review the login page', { command: { name: 'review', args: 'the login page' } }))
    expect(engine.entered()?.context).toEqual([])
  })

  test('a prompt the engine wrote', async ($, on) => {
    const engine = engineBeneath(on)
    await $.prompt.submit(typed('the build finished with errors', { isMeta: true }))
    expect(engine.entered()?.context).toEqual([])
  })

  test('a background task notification', async ($, on) => {
    const engine = engineBeneath(on)
    await $.prompt.submit(typed('the build finished with errors', { origin: { kind: 'task-notification' } }))
    expect(engine.entered()?.context).toEqual([])
  })

  test('a headless run', async ($, on) => {
    const engine = engineBeneath(on)
    await $.prompt.submit(typed('why does the login fail', { origin: { kind: 'sdk' } }))
    expect(engine.entered()?.context).toEqual([])
  })
})

const TERMINAL = { isFullscreen: false, columns: 80 }

function shush(args: string) {
  return { command: 'shush', args, origin: { kind: 'composer' }, presentation: TERMINAL } as const
}

function statusLine(on: On): (string | undefined)[] {
  const shown: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  return shown
}

describe('the /shush command', () => {
  test('/shush off stops the rules for the next prompts', async ($, on) => {
    const engine = engineBeneath(on)
    const ran = await $.command.run(shush('off'))
    await $.prompt.submit(typed('why does the login fail'))
    expect(ran.text).toContain('off')
    expect(engine.entered()?.context).toEqual([])
  })

  test('/shush off says so in the status line', async ($, on) => {
    engineBeneath(on)
    const shown = statusLine(on)
    await $.command.run(shush('off'))
    expect(shown).toEqual(['shush: off'])
  })

  test('/shush on brings the rules back and clears the status line', async ($, on) => {
    const engine = engineBeneath(on)
    const shown = statusLine(on)
    await $.command.run(shush('off'))
    const ran = await $.command.run(shush('on'))
    await $.prompt.submit(typed('why does the login fail'))
    expect(ran.text).toContain('back on')
    expect(engine.entered()?.context).toEqual([RULES])
    expect(shown).toEqual(['shush: off', undefined])
  })

  test('/shush alone turns the rules off, then back on', async ($, on) => {
    const engine = engineBeneath(on)
    await $.command.run(shush(''))
    await $.prompt.submit(typed('why does the login fail'))
    expect(engine.entered()?.context).toEqual([])
    await $.command.run(shush(''))
    await $.prompt.submit(typed('why does the login fail'))
    expect(engine.entered()?.context).toEqual([RULES])
  })

  test('/shush with another word explains its usage and changes nothing', async ($, on) => {
    const engine = engineBeneath(on)
    const ran = await $.command.run(shush('loud'))
    await $.prompt.submit(typed('why does the login fail'))
    expect(ran.text).toContain('/shush off')
    expect(engine.entered()?.context).toEqual([RULES])
  })

  test('run by another plugin, it keeps the rules on', async ($, on) => {
    const engine = engineBeneath(on)
    const ran = await $.command.run({ ...shush('off'), origin: { kind: 'plugin', name: 'other' } })
    await $.prompt.submit(typed('why does the login fail'))
    expect(ran.text).toContain('typed at the prompt')
    expect(engine.entered()?.context).toEqual([RULES])
  })

  test('sent through Remote Control, it turns the rules off', async ($, on) => {
    const engine = engineBeneath(on)
    await $.command.run({ ...shush('off'), origin: { kind: 'bridge' } })
    await $.prompt.submit(typed('why does the login fail'))
    expect(engine.entered()?.context).toEqual([])
  })

  test('an interactive session lists it', async ($, on) => {
    engineBeneath(on)
    const registered: string[] = []
    on('command.register', (_, e) => {
      registered.push(e.name)
      return { value: { command: e.name } }
    })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    expect(registered).toEqual(['shush'])
  })

  test('a reload while it is off shows the status line again', async ($, on) => {
    engineBeneath(on)
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    const shown = statusLine(on)
    await $.command.run(shush('off'))
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    expect(shown).toEqual(['shush: off', 'shush: off'])
  })
})
