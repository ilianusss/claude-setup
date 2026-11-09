import type { EngineInterface, Timer, TurnUsage } from 'claude-code'

import type { CacheSnap, UsageSnap } from '../../types'
import { cacheTtlOf, countdownsOf, lastRequestIn, limitLabel, metersOf, warmthOf } from '../svg/svg-usage'
import type { Meter } from '../svg/svg-usage'
import { settleEntrances } from './entrances'
import { debugLog, getCache, getCompacting, getCountdowns, getPrefs, getUsage, getWarmth, setCache, setCompacting, setCountdowns, setUsage, setWarmth } from './state'
import type { Active } from './state'

// Fires as the cache goes cold, so the meter says so on time rather than at the next minute.
let coldTimer: Timer | undefined

export async function refreshUsage($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()
  const snap: UsageSnap = {
    context: usage.context.percent ?? null,
    ...(usage.context.tokens === undefined ? {} : { tokens: { used: usage.context.tokens, window: usage.context.window } }),
    limits: usage.rateLimits.map(limit => {
      const resetsAt = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)

      return { label: limitLabel(limit.kind), percent: limit.percentUsed, ...(Number.isNaN(resetsAt) ? {} : { resetsAt }) }
    }),
  }
  // A window that resets moves its reset time even where its percent stays the same.
  const drawn = (of: UsageSnap) => JSON.stringify([metersOf(of), of.limits.map(limit => limit.resetsAt ?? null)])

  if (drawn(await getUsage($)) === drawn(snap)) {
    return
  }

  await settleEntrances($, true)
  await setUsage($, snap)
}

// Redraws the band only when a countdown would read differently.
export async function tickCountdowns($: EngineInterface): Promise<void> {
  const prefs = await getPrefs($)

  if (!prefs.countdown || !prefs.band) {
    return
  }

  const next = countdownsOf(await getUsage($), await $.clock.now())

  if (JSON.stringify(next) === JSON.stringify(await getCountdowns($))) {
    return
  }

  await settleEntrances($, true)
  await setCountdowns($, next)
}

async function limitsNow($: EngineInterface): Promise<{ percent: number }[]> {
  return (await $.session.usage()).rateLimits.map(limit => ({ percent: limit.percentUsed }))
}

// A main-loop request that used the prompt cache keeps it warm from when it was sent; one that
// neither read nor wrote it means caching is off, and the meter goes.
export async function noteRequest($: EngineInterface, sentAt: number, usage: TurnUsage): Promise<void> {
  const hasRead = usage.cache_read_input_tokens > 0
  const before = await getCache($)
  const cache = hasRead || usage.cache_creation_input_tokens > 0 ? { sentAt, ttlMs: cacheTtlOf(before, sentAt, hasRead, await limitsNow($)) } : null

  await holdCache($, cache)
}

// A resumed conversation's cache is as warm as its transcript's last request left it. A
// transcript over 4 MiB leaves the meter to the next request (resuming touches its file time).
export async function seedCache($: EngineInterface, transcript: string): Promise<void> {
  const found = lastRequestIn(await $.fs.read(transcript))

  if (found === undefined) {
    return
  }

  await holdCache($, { sentAt: found.sentAt, ttlMs: found.ttlMs ?? cacheTtlOf(null, found.sentAt, false, await limitsNow($)) })
}

async function holdCache($: EngineInterface, cache: CacheSnap | null): Promise<void> {
  await setCache($, cache)
  await tickWarmth($)

  coldTimer?.cancel()
  coldTimer =
    cache === null
      ? undefined
      : $.clock.after(Math.max(1, cache.sentAt + cache.ttlMs - (await $.clock.now()) + 1), () => {
          void tickWarmth($).catch(debugLog($, 'cache tick: '))
        })
}

export async function tickWarmth($: EngineInterface): Promise<void> {
  const next = warmthOf(await getCache($), await $.clock.now())

  if (JSON.stringify(next) === JSON.stringify(await getWarmth($))) {
    return
  }

  await settleEntrances($, true)
  await setWarmth($, next)
}

// The meters as they read now, from the clock so a countdown switched on shows at once; reading
// the atoms redraws the band when the minute tick changes one.
export async function metersNow($: EngineInterface, active: Active | null): Promise<Meter[]> {
  const usage = await getUsage($)
  const countdowns = active?.prefs.countdown === true ? (await getCountdowns($), countdownsOf(usage, await $.clock.now())) : {}

  return metersOf(usage, countdowns, await getWarmth($))
}

// The band's Compact button runs Claude Code's own /compact. Never mid-turn: it would cut the
// turn's context. A press abandons its work when it ends, which would cancel the compaction, so
// a timer starts it in a dispatch of its own; the button hides until it ends.
export async function compactControl($: EngineInterface, active: Active, isWorking: boolean): Promise<{ canCompact: boolean; compact: () => void }> {
  const isCompacting = await getCompacting($)
  const compact = () => {
    void setCompacting($, true)
    $.clock.after(1, () =>
      $.command
        .run({ command: 'compact' })
        .catch((error: unknown) => $.ui.toast(`Compacting failed: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => setCompacting($, false)),
    )
  }

  return { canCompact: active.prefs.compact && !isWorking && !isCompacting, compact }
}
