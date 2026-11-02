import type { EngineInterface } from 'claude-code'

export function ask($: EngineInterface, question: string, options: readonly string[], header: string): Promise<string> {
  return $.ui.ask(question, { options, header })
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
