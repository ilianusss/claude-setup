import type { On, Timer } from 'claude-code'

import type { Touch } from '../../types'
import { commandOf, isQuiet } from '../tools/quiet'
import { SHELLS } from '../tools/shell'
import { markGutter } from '../ui/band'
import { diffstat } from '../util/format'
import { isSettling, settleAfterRender, settleEntrances } from './entrances'
import { load, noteLoadedSession, reloadIfNewSession } from './prefs'
import { EDITS } from './render-tools'
import { addTurn, clearTouched, debugLog, FRAME_MS, live, markImagesOf, markQuietOf, nextFrame, NO_STATS, setCommandOfCall, setDurationOf, setLastReply, setStarted, touch } from './state'
import type { Turn } from './state'
import { noteRequest, refreshUsage, seedCache, tickCountdowns, tickWarmth } from './usage'

// Countdowns read to the minute, so they are looked at once a minute.
const COUNTDOWN_MS = 60_000
const WRITES = new Set([...EDITS, 'NotebookEdit'])

// The session and turn events: loading, timers, and what the rows need to know about each call.
export function hookLifecycle(on: On, turn: Turn): void {
  let ticker: Timer | undefined
  let countdownTicker: Timer | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'skin',
      description: 'Open the skin settings, or /skin <name | list | help | off>',
      argumentHint:
        '[help | gallery | copy | copy code | name | list | off | calm | pin | unpin | share | rail | tables | shimmer | band | countdown | clip | markdown | quiet | charts | math | commands | shell | highlight | hints | links | fold | expand | compact | icons | prompt | words]',
      immediate: true,
    })
    await noteLoadedSession($)
    turn.gutter = await $.session
      .version()
      .then(version => markGutter(version.base ?? version.version))
      .catch((error: unknown) => {
        debugLog($, 'engine version: ')(error)
        return 0
      })
    await load($)
    await refreshUsage($)

    // Only the spinner reads the frame, so a tick redraws the spinner and nothing else.
    ticker?.cancel()
    ticker = $.clock.every(FRAME_MS, () => {
      if (turn.isWorking) {
        void nextFrame($)
      }

      if (isSettling()) {
        void settleEntrances($)
      }
    })
    countdownTicker?.cancel()
    countdownTicker = $.clock.every(COUNTDOWN_MS, () => {
      void tickCountdowns($).catch(debugLog($, 'countdown tick: '))
      void tickWarmth($).catch(debugLog($, 'cache tick: '))
    })

    return next(e)
  })

  // Where the plan's guard lets it through this comes first; session.append then finds the
  // session loaded.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await reloadIfNewSession($, typeof e.session_id === 'string' && e.session_id !== '' ? e.session_id : undefined)

    if (e.source !== 'clear' && typeof e.transcript_path === 'string' && e.transcript_path !== '') {
      await seedCache($, e.transcript_path).catch(debugLog($, 'cache from transcript: '))
    }

    return next(e)
  })

  on('ui.invalidate', async ($, e, next) => {
    if (e.event === 'ui.render') {
      await settleAfterRender($)
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    turn.stats = NO_STATS
    turn.isWorking = true
    // A worktree can move the session between turns.
    live.cwd = await $.session.cwd()
    live.hasTouched = false
    await clearTouched($)
    await setStarted($, await $.clock.now())

    return next(e)
  })

  // Loads the prefs again for a new session, and notes which prompts carried images, so their
  // row keeps Claude Code's drawing of them.
  on('session.append', async ($, e, next) => {
    await reloadIfNewSession($)
    const stored = await next(e)
    const hasImage = e.door === 'prompt' && e.message.content.some(block => block.type === 'image')

    if (hasImage && stored.uuid !== undefined) {
      await markImagesOf($, { requestId: stored.uuid })
    }

    return stored
  })

  // A turn's end and a plan limit's move are when the band's numbers change.
  on('session.measure', async ($, e, next) => {
    await refreshUsage($)

    return next(e)
  })

  // The main loop's requests keep the prompt cache warm, timed from when each was sent. A
  // subagent's run is its own conversation, with its own cache.
  on('turn.step', async function* ($, e, next) {
    const sentAt = await $.clock.now()
    const response = yield* next(e)

    if (e.agentId === undefined && response.usage !== null) {
      await noteRequest($, sentAt, response.usage).catch(debugLog($, 'cache: '))
    }

    return response
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await refreshUsage($)
      turn.isWorking = false
      const finished = turn.stats
      await addTurn($, e.durationMs, finished)

      if (e.answer.trim() !== '') {
        await setLastReply($, e.answer)
      }
    }

    return next(e)
  })

  // Times every call and counts the main loop's calls and changed lines.
  on('tool.call', async ($, e, next) => {
    // Its output card's header names the command, which the result does not carry.
    if (SHELLS.has(e.tool)) {
      const command = commandOf(e)
      await setCommandOfCall($, { requestId: e.tool_use_id }, command)
    }

    const startedAt = await $.clock.now()
    const ran = await next(e)
    const ms = (await $.clock.now()) - startedAt

    await setDurationOf($, { requestId: e.tool_use_id }, ms)

    if (isQuiet(e.tool, e)) {
      await markQuietOf($, { requestId: e.tool_use_id })
    }

    // A file the call made or changed takes its colour in this turn's rows and prose.
    const file = (e as { file_path?: unknown; notebook_path?: unknown }).file_path ?? (e as { notebook_path?: unknown }).notebook_path

    if (WRITES.has(e.tool) && ran.deny === undefined && typeof file === 'string' && file !== '') {
      const how: Touch = (ran.result as { type?: unknown } | undefined)?.type === 'create' ? 'created' : 'edited'
      live.hasTouched = true
      await touch($, file, how)
    }

    if (e.agentId === undefined && ran.deny === undefined) {
      const diff = diffstat(ran.result)
      turn.stats = {
        tools: turn.stats.tools + 1,
        added: turn.stats.added + (diff?.added ?? 0),
        removed: turn.stats.removed + (diff?.removed ?? 0),
      }
    }

    return ran
  })
}
