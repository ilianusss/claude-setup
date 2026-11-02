import type { EngineInterface } from 'claude-code'

export function iso(ms: number): string {
  return new Date(ms).toISOString()
}

export function day(ms: number): string {
  return iso(ms).slice(0, 10)
}

export function submitLater($: EngineInterface, text: string): void {
  $.clock.after(0, () => void $.prompt.submit({ text }))
}

export function clearThenSubmit($: EngineInterface, text: string): void {
  $.clock.after(0, () => {
    void (async () => {
      await $.command.run({ command: 'clear' })
      await $.prompt.submit({ text })
    })()
  })
}
