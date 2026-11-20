import type { EngineInterface } from 'claude-code'

import { whileWaiting } from './status'

export function ask($: EngineInterface, question: string, options: readonly string[], header: string): Promise<string> {
  return whileWaiting($, () => $.ui.ask(question, { options, header }))
}

export async function askOrUndefined(
  $: EngineInterface,
  question: string,
  options: readonly string[],
  header: string,
): Promise<string | undefined> {
  try {
    return await ask($, question, options, header)
  } catch {
    return undefined
  }
}
