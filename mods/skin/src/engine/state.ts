import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CacheSnap, Disclosure, Prefs, Touch, TurnStats, UsageSnap, Warmth } from '../../types'
import { DEFAULT_PREFS } from '../prefs/command'
import type { Skin } from '../skins/skin'
import type { ThemeHome } from '../skins/theme-home'
import { messageOf } from '../util/format'

// Every piece of session state, and the only file that reads or writes it: the engine scans
// each read/update for an atom declared in the same file. A write redraws what read the atom.
// `Of` accessors take one member of a family, keyed by the drawing's requestId.

type Member = { requestId: string }
type $ = EngineInterface

const prefsAtom = atom({ plugin: 'skin', key: 'prefs' } as const, DEFAULT_PREFS)
// The theme home's palettes as skins, and the one it has selected; null without one.
const themeAtom = atom({ plugin: 'skin', key: 'theme' } as const, null as ThemeHome | null)
const pinnedAtom = atom({ plugin: 'skin', key: 'pinned' } as const, false)
const startedAtom = atom({ plugin: 'skin', key: 'startedAt' } as const, 0)
const frameAtom = atom({ plugin: 'skin', key: 'frame' } as const, 0)
const turnsAtom = atom({ plugin: 'skin', key: 'turns' } as const, {} as Record<string, TurnStats>)
const durationAtom = atom({ plugin: 'skin', key: 'duration' } as const, -1)
const imagesAtom = atom({ plugin: 'skin', key: 'images' } as const, false)
// Whether a call only looked, so quiet output folds its result away.
const quietAtom = atom({ plugin: 'skin', key: 'quiet' } as const, false)
// A shell call's command, for its card's header: ToolResult does not carry it.
const commandAtom = atom({ plugin: 'skin', key: 'command' } as const, '')
const usageAtom = atom({ plugin: 'skin', key: 'usage' } as const, { context: null, limits: [] } as UsageSnap)
// The band's countdowns as last drawn: it redraws only when one reads differently.
const countdownsAtom = atom({ plugin: 'skin', key: 'countdowns' } as const, {} as Record<string, string>)
// The main loop's last request (the band does not read it) and the cache meter as last drawn.
const cacheAtom = atom({ plugin: 'skin', key: 'cache' } as const, null as CacheSnap | null)
const warmthAtom = atom({ plugin: 'skin', key: 'warmth' } as const, null as Warmth | null)
const compactingAtom = atom({ plugin: 'skin', key: 'compacting' } as const, false)
const settleAtom = atom({ plugin: 'skin', key: 'settle' } as const, 0)
// Whether each tool row is open, as the person left it; `auto` opens a failed call.
const disclosureAtom = atom({ plugin: 'skin', key: 'disclosure' } as const, 'auto' as Disclosure)
// Whether an opened row shows its answer whole, past the fold.
const allAtom = atom({ plugin: 'skin', key: 'showAll' } as const, false)
// Files this turn created or edited, by absolute path.
const touchedAtom = atom({ plugin: 'skin', key: 'touched' } as const, {} as Record<string, Touch>)
// Per drawing, the blocks the person unfolded.
const foldsAtom = atom({ plugin: 'skin', key: 'folds' } as const, [] as string[])
// The main loop's last answer, for `/skin copy`.
const lastReplyAtom = atom({ plugin: 'skin', key: 'lastReply' } as const, '')

const KEPT_TURNS = 40

export function getPrefs($: $): Promise<Prefs> {
  return read($, prefsAtom)
}
export async function setPrefs($: $, prefs: Prefs): Promise<void> {
  await update($, prefsAtom, () => prefs)
}

export function getTheme($: $): Promise<ThemeHome | null> {
  return read($, themeAtom)
}
export async function setTheme($: $, theme: ThemeHome | null): Promise<void> {
  await update($, themeAtom, () => theme)
}

export function getPinned($: $): Promise<boolean> {
  return read($, pinnedAtom)
}
export async function setPinned($: $, pinned: boolean): Promise<void> {
  await update($, pinnedAtom, () => pinned)
}

export function getStarted($: $): Promise<number> {
  return read($, startedAtom)
}
export async function setStarted($: $, at: number): Promise<void> {
  await update($, startedAtom, () => at)
}

export function getFrame($: $): Promise<number> {
  return read($, frameAtom)
}
export async function nextFrame($: $): Promise<void> {
  await update($, frameAtom, frame => frame + 1)
}

export function getTurns($: $): Promise<Record<string, TurnStats>> {
  return read($, turnsAtom)
}
// Kept by duration, which is how the footer finds its turn.
export async function addTurn($: $, durationMs: number, stats: TurnStats): Promise<void> {
  await update($, turnsAtom, turns => Object.fromEntries([...Object.entries(turns), [String(durationMs), stats]].slice(-KEPT_TURNS)))
}

export function getUsage($: $): Promise<UsageSnap> {
  return read($, usageAtom)
}
export async function setUsage($: $, usage: UsageSnap): Promise<void> {
  await update($, usageAtom, () => usage)
}

export function getCountdowns($: $): Promise<Record<string, string>> {
  return read($, countdownsAtom)
}
export async function setCountdowns($: $, countdowns: Record<string, string>): Promise<void> {
  await update($, countdownsAtom, () => countdowns)
}

export function getCache($: $): Promise<CacheSnap | null> {
  return read($, cacheAtom)
}
export async function setCache($: $, cache: CacheSnap | null): Promise<void> {
  await update($, cacheAtom, () => cache)
}

export function getWarmth($: $): Promise<Warmth | null> {
  return read($, warmthAtom)
}
export async function setWarmth($: $, warmth: Warmth | null): Promise<void> {
  await update($, warmthAtom, () => warmth)
}

export function getCompacting($: $): Promise<boolean> {
  return read($, compactingAtom)
}
export async function setCompacting($: $, compacting: boolean): Promise<void> {
  await update($, compactingAtom, () => compacting)
}

// Read by a drawing with a card still entering, so the next settle round redraws it.
export async function watchSettle($: $): Promise<void> {
  await read($, settleAtom)
}
export async function nextSettle($: $): Promise<void> {
  await update($, settleAtom, round => round + 1)
}

export function getTouched($: $): Promise<Record<string, Touch>> {
  return read($, touchedAtom)
}
export async function clearTouched($: $): Promise<void> {
  await update($, touchedAtom, () => ({}))
}
// A file created this turn stays `created` whatever edits follow.
export async function touch($: $, file: string, how: Touch): Promise<void> {
  await update($, touchedAtom, touched => (touched[file] === 'created' ? touched : { ...touched, [file]: how }))
}

export function getLastReply($: $): Promise<string> {
  return read($, lastReplyAtom)
}
export async function setLastReply($: $, reply: string): Promise<void> {
  await update($, lastReplyAtom, () => reply)
}

export function durationOf($: $, e: Member): Promise<number> {
  return read($, memberOf(durationAtom, e))
}
export async function setDurationOf($: $, e: Member, ms: number): Promise<void> {
  await update($, memberOf(durationAtom, e), () => ms)
}

export function hasImagesOf($: $, e: Member): Promise<boolean> {
  return read($, memberOf(imagesAtom, e))
}
export async function markImagesOf($: $, e: Member): Promise<void> {
  await update($, memberOf(imagesAtom, e), () => true)
}

export function isQuietOf($: $, e: Member): Promise<boolean> {
  return read($, memberOf(quietAtom, e))
}
export async function markQuietOf($: $, e: Member): Promise<void> {
  await update($, memberOf(quietAtom, e), () => true)
}

export function commandOfCall($: $, e: Member): Promise<string> {
  return read($, memberOf(commandAtom, e))
}
export async function setCommandOfCall($: $, e: Member, command: string): Promise<void> {
  await update($, memberOf(commandAtom, e), () => command)
}

export function disclosureOf($: $, e: Member): Promise<Disclosure> {
  return read($, memberOf(disclosureAtom, e))
}
export async function setDisclosureOf($: $, e: Member, disclosure: Disclosure): Promise<void> {
  await update($, memberOf(disclosureAtom, e), () => disclosure)
}

export function showsAllOf($: $, e: Member): Promise<boolean> {
  return read($, memberOf(allAtom, e))
}
export async function setShowsAllOf($: $, e: Member, isAll: boolean): Promise<void> {
  await update($, memberOf(allAtom, e), () => isAll)
}

export function foldsOf($: $, e: Member): Promise<string[]> {
  return read($, memberOf(foldsAtom, e))
}
export async function toggleFoldOf($: $, e: Member, key: string): Promise<void> {
  await update($, memberOf(foldsAtom, e), keys => (keys.includes(key) ? keys.filter(kept => kept !== key) : [...keys, key]))
}

export type Active = { prefs: Prefs; skin: Skin }

// Read once a session or a turn and kept here: each read through `$` is a dispatch, and rows
// draw often.
export const live = {
  // Whether the terminal draws OSC 8 links.
  hyperlinks: false,
  cwd: undefined as string | undefined,
  // Whether this turn touched a file at all (the files themselves are in the touched atom).
  hasTouched: false,
}

// The main loop's turn, owned by one register() call.
export type Turn = {
  stats: TurnStats
  isWorking: boolean
  // The columns the band keeps clear for the engine's collapse mark, by the engine's version.
  gutter: number
  // The width the last reply was drawn at, shown by /skin list.
  lastColumns?: number
}

export const NO_STATS: TurnStats = { tools: 0, added: 0, removed: 0 }

export const newTurn = (): Turn => ({ stats: NO_STATS, isWorking: false, gutter: 0 })

export const FRAME_MS = 90

// A failure that costs one drawing or meter, never the session, goes to the debug log.
export function debugLog($: $, prefix = ''): (error: unknown) => void {
  return error => {
    $.ui.log(`${prefix}${messageOf(error)}`, { to: 'debug' })
  }
}
