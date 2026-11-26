import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { submitLater } from './clock'

// Kept in $.state, which a reload of the mod keeps, so a hand-over waiting for the turn to end survives a reload.
const queued = atom({ plugin: 'workflow', key: 'queuedHandovers' } as const, [], { shape: 'queued-handovers-1' })
// Whether the conversation's own loop runs a turn. The band's activity cannot say: a dialog of the mod shows "waiting
// for you" in the middle of a turn.
const mainLoop = atom({ plugin: 'workflow', key: 'mainLoop' } as const, { isInTurn: false }, { shape: 'main-loop-3' })

const BETWEEN = '\n\n---\n\n'

// Any turn of the main loop counts, a command's or one started without a typed prompt included.
export async function mainTurnStarted($: EngineInterface): Promise<void> {
  await update($, mainLoop, () => ({ isInTurn: true }))
}

// A prompt the user queued during the turn starts the next one at once: the hand-over goes only when no turn started
// in between. The engine runs a plugin's prompt once the session is idle, in order with the user's queued ones.
export async function mainTurnEnded($: EngineInterface): Promise<void> {
  await update($, mainLoop, () => ({ isInTurn: false }))
  $.clock.after(0, () => void submitQueued($))
}

// A prompt submitted while the conversation's turn ran was seen to reach it late or never, and lanes end at any time:
// a hand-over waits until the main loop is idle, and the ones that waited together go as one prompt.
export async function handOverWhenIdle($: EngineInterface, text: string): Promise<void> {
  await update($, queued, texts => [...texts, text])
  await submitQueued($)
}

async function submitQueued($: EngineInterface): Promise<void> {
  if ((await read($, mainLoop)).isInTurn) return
  let taken: readonly string[] = []
  await update($, queued, texts => {
    taken = texts
    return []
  })
  if (taken.length > 0) submitLater($, taken.join(BETWEEN))
}
