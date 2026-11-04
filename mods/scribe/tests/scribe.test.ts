import type { ModelCompleteInput, ModelCompleteResult, On, PromptSubmitInput } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

type Engine = { submitted: () => string | undefined; toasts: string[]; modelCalls: () => number; request: () => ModelCompleteInput | undefined }

function engineBeneath(on: On, reply: ModelCompleteResult | Error): Engine {
  let submitted: string | undefined
  let modelCalls = 0
  let request: ModelCompleteInput | undefined
  const toasts: string[] = []
  on('model.complete', (_, e) => {
    modelCalls += 1
    request = e
    if (reply instanceof Error) throw reply
    return { value: reply }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    submitted = e.text
    return { text: e.text }
  })
  return { submitted: () => submitted, toasts, modelCalls: () => modelCalls, request: () => request }
}

function answered(text: string): ModelCompleteResult {
  return { isAnswered: true, text, usage: USAGE }
}

function typed(text: string): PromptSubmitInput {
  return { text, wait: false, origin: { kind: 'composer' } }
}

describe('a prompt typed at the composer', () => {
  test('reaches the model with its typos fixed', async ($, on) => {
    const engine = engineBeneath(on, answered('can you fix the login page please'))
    await $.prompt.submit(typed('can you fix teh login page pls'))
    expect(engine.submitted()).toBe('can you fix the login page please')
  })

  test('shows what changed in a toast', async ($, on) => {
    const engine = engineBeneath(on, answered('can you fix the login page please'))
    await $.prompt.submit(typed('can you fix teh login page pls'))
    expect(engine.toasts).toEqual(['scribe: teh → the, pls → please'])
  })

  test('shows no toast when nothing needed fixing', async ($, on) => {
    const engine = engineBeneath(on, answered('can you fix the login page'))
    await $.prompt.submit(typed('can you fix the login page'))
    expect(engine.submitted()).toBe('can you fix the login page')
    expect(engine.toasts).toEqual([])
  })

  test('asks Haiku with a timeout, the prompt inside message tags', async ($, on) => {
    const engine = engineBeneath(on, answered('can you fix the login page'))
    await $.prompt.submit(typed('can you fix teh login page'))
    expect(engine.request()).toMatchObject({ model: 'haiku', timeoutMs: 4000 })
    expect(engine.request()?.prompt).toBe('<message>\ncan you fix teh login page\n</message>')
  })

  test('takes a reply that differs only in surrounding whitespace as unchanged', async ($, on) => {
    const engine = engineBeneath(on, answered('can you fix the login page\n'))
    await $.prompt.submit(typed('can you fix the login page'))
    expect(engine.submitted()).toBe('can you fix the login page')
    expect(engine.toasts).toEqual([])
  })

  test('unwraps a reply that kept the message tags', async ($, on) => {
    const engine = engineBeneath(on, answered('<message>\ncan you fix the login page\n</message>'))
    await $.prompt.submit(typed('can you fix teh login page'))
    expect(engine.submitted()).toBe('can you fix the login page')
  })

  test('sends the prompt as typed when the correction is not safe', async ($, on) => {
    const engine = engineBeneath(on, answered('A login page usually fails because the session token expired.'))
    await $.prompt.submit(typed('why dose teh login fail'))
    expect(engine.submitted()).toBe('why dose teh login fail')
    expect(engine.toasts).toEqual([])
  })
})

describe('a prompt scribe leaves alone', () => {
  const CORRECTION = answered('a correction nobody asked for')

  test('a slash command', async ($, on) => {
    const engine = engineBeneath(on, CORRECTION)
    await $.prompt.submit({ ...typed('/review teh login page'), command: { name: 'review', args: 'teh login page' } })
    expect(engine.modelCalls()).toBe(0)
    expect(engine.submitted()).toBe('/review teh login page')
  })

  test('a prompt the engine wrote', async ($, on) => {
    const engine = engineBeneath(on, CORRECTION)
    await $.prompt.submit({ ...typed('teh build finished wiht errors'), isMeta: true })
    expect(engine.modelCalls()).toBe(0)
    expect(engine.submitted()).toBe('teh build finished wiht errors')
  })

  test('a background task notification', async ($, on) => {
    const engine = engineBeneath(on, CORRECTION)
    await $.prompt.submit({ ...typed('teh build finished wiht errors'), origin: { kind: 'task-notification' } })
    expect(engine.modelCalls()).toBe(0)
    expect(engine.submitted()).toBe('teh build finished wiht errors')
  })

  test('a prompt of two words', async ($, on) => {
    const engine = engineBeneath(on, CORRECTION)
    await $.prompt.submit(typed('yes plz'))
    expect(engine.modelCalls()).toBe(0)
    expect(engine.submitted()).toBe('yes plz')
  })

  test('a prompt of 2,000 characters or more', async ($, on) => {
    const paste = `whats wrong here ${'x'.repeat(2000)}`
    const engine = engineBeneath(on, CORRECTION)
    await $.prompt.submit(typed(paste))
    expect(engine.modelCalls()).toBe(0)
    expect(engine.submitted()).toBe(paste)
  })
})

describe('a correction scribe cannot get', () => {
  test('Haiku times out: the prompt goes as typed', async ($, on) => {
    const engine = engineBeneath(on, { isAnswered: false, reason: 'aborted', usage: USAGE })
    await $.prompt.submit(typed('can you fix teh login page'))
    expect(engine.submitted()).toBe('can you fix teh login page')
    expect(engine.toasts).toEqual([])
  })

  test('the engine refuses the call: the prompt goes as typed', async ($, on) => {
    const engine = engineBeneath(on, new Error('model blocked'))
    await $.prompt.submit(typed('can you fix teh login page'))
    expect(engine.submitted()).toBe('can you fix teh login page')
  })
})
