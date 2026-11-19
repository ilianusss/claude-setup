import type { EngineInterface, RenderSurface } from 'claude-code'

import type { Prefs } from '../../types'
import { sightings } from '../util/sightings'
import { debugLog, FRAME_MS, nextSettle, watchSettle } from './state'

// A card animates on its first draw only. Once its entrance ends the drawing is settled (redrawn
// with animations off), so a repaint of the stored drawing cannot replay it.
const SETTLE_LEAD_MS = FRAME_MS
const FAST_RETRIES = 4
const RETRY_MAX_MS = 1000
const STALE_AHEAD_MS = RETRY_MAX_MS + 1000

type Drawing = { surface: RenderSurface; requestId: string }

// Keyed by the drawing's instance (message id, tool_use_id), so two replies never share a card.
const seenCards = sightings()
const settling = new Map<string, { at: number; cards: string[] }>()
let settlingNow = new Set<string>()
let refusals = 0

export const drawingOf = (e: Drawing): string => `${e.surface}:${e.requestId}`

export const isSettling = (): boolean => settling.size > 0

const drawnBy = (drawing: string, drawnAt: number) => (key: string, entranceMs: number) => {
  const card = `${drawing}:${key}`

  if (settlingNow.delete(card)) {
    seenCards(card)

    return false
  }

  const isFirst = seenCards(card)

  if (isFirst) {
    const pending = settling.get(drawing)

    settling.set(drawing, {
      at: Math.max(pending?.at ?? 0, drawnAt + entranceMs - SETTLE_LEAD_MS),
      cards: [...(pending?.cards ?? []), card],
    })
  }

  return isFirst
}

// Calm draws every card settled, its first draw included.
export async function firstDraws($: EngineInterface, e: Drawing, prefs: Prefs): Promise<(key: string, entranceMs: number) => boolean> {
  const drawing = drawingOf(e)
  settling.delete(drawing)

  return prefs.calm === null ? drawnBy(drawing, await $.clock.now()) : () => false
}

// A drawing with a card still entering reads the settle round, so settling redraws it.
export async function withSettle<T>($: EngineInterface, e: Drawing, drawn: T): Promise<T> {
  if (settling.has(drawingOf(e))) {
    await watchSettle($)
  }

  return drawn
}

export async function settleEntrances($: EngineInterface, isForced = false): Promise<boolean> {
  const now = await $.clock.now()
  const isDue = (at: number): boolean => at <= now || at > now + STALE_AHEAD_MS

  if (settling.size === 0 || (!isForced && ![...settling.values()].some(pending => isDue(pending.at)))) {
    return true
  }

  const moved = [...settling]
  settlingNow = new Set(moved.flatMap(([, pending]) => pending.cards))
  settling.clear()

  return nextSettle($).then(
    () => {
      refusals = 0

      return true
    },
    (error: unknown) => {
      refusals += 1
      const retryAt = now + Math.min(RETRY_MAX_MS, refusals <= FAST_RETRIES ? 0 : FRAME_MS * 2 ** (refusals - FAST_RETRIES))

      for (const [drawing, pending] of moved) {
        if (!settling.has(drawing)) {
          settling.set(drawing, { ...pending, at: retryAt })
        }
      }

      debugLog($, 'settle: ')(error)

      return false
    },
  )
}

// A redraw the engine refused mid-render is tried again at once, a few times, then on the tick.
export async function settleAfterRender($: EngineInterface): Promise<void> {
  if (!(await settleEntrances($, true)) && refusals <= FAST_RETRIES) {
    await $.clock.sleep(FRAME_MS / 3)
    await settleEntrances($, true)
  }
}
