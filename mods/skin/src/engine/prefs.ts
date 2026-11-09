import type { EngineInterface } from 'claude-code'

import type { Prefs } from '../../types'
import { parsePrefs } from '../prefs/command'
import { parseFolders, prefsFor, withFolder, withoutFolder } from '../prefs/folders'
import { fallbackOf, namesOf } from '../skins/catalog'
import type { ThemeHome } from '../skins/theme-home'
import { readHyperlinks } from './look'
import { debugLog, getPinned, getPrefs, getTheme, live, setPinned, setPrefs, setTheme } from './state'
import { loadThemeHome, selectPalette, stopThemeHome, themeHomeOf, watchThemeHome } from './theme-home'

// The session the prefs were last loaded for. /clear, /resume and /branch reset $.state and skip
// session.start, and on Team/Enterprise plans classic.SessionStart may not reach user mods: the
// new session's first appended row catches the change instead.
let loadedFor: string | undefined

// Undefined where nothing answers for the session's id (a test's engine).
export function sessionId($: EngineInterface): Promise<string | undefined> {
  return $.session.id().catch(() => undefined)
}

export async function noteLoadedSession($: EngineInterface): Promise<void> {
  loadedFor = await sessionId($)
}

// With a theme home the skin is the palette it has selected, unless it is off.
const inCatalog = (prefs: Prefs, theme: ThemeHome | null): Prefs =>
  theme === null || prefs.skin === 'off' ? prefs : { ...prefs, skin: fallbackOf(theme) }

export async function load($: EngineInterface): Promise<void> {
  const home = await themeHomeOf($).catch(() => undefined)
  const theme = home === undefined ? null : await loadThemeHome($, home)
  const names = namesOf(theme)
  const folders = parseFolders(await $.store.get('folders'), names)
  const folder = await $.session.cwd()
  live.cwd = folder
  const prefs = inCatalog(prefsFor(folder, folders, parsePrefs(await $.store.get('prefs'), names)), theme)

  await setTheme($, theme)
  await setPrefs($, prefs)
  await setPinned($, Object.hasOwn(folders, folder))

  if (home === undefined) {
    stopThemeHome()
  } else {
    watchThemeHome($, home, moved => followThemeHome($, moved))
  }

  // Links stay text if the environment cannot be read; the look loads either way.
  await readHyperlinks($).catch(debugLog($, 'hyperlink check: '))
}

// `theme` ran somewhere (a shell, another session): take its palettes and its selection.
async function followThemeHome($: EngineInterface, theme: ThemeHome): Promise<void> {
  await setTheme($, theme)
  const prefs = await getPrefs($)

  if (prefs.skin !== 'off' && theme.current !== null && prefs.skin !== theme.current) {
    await setPrefs($, { ...prefs, skin: theme.current })
  }
}

// `known` is the id a hook was handed: on /resume, $.session.id() can still answer the old one.
export async function reloadIfNewSession($: EngineInterface, known?: string): Promise<void> {
  const id = known ?? (await sessionId($))

  if (id === undefined || id === loadedFor) {
    return
  }

  loadedFor = id

  // A resumed scheduled-task session can start before Claude Code has bound it: the next append
  // tries again.
  try {
    await load($)
  } catch (error) {
    if (loadedFor === id) {
      loadedFor = undefined
    }
    debugLog($, 'not loaded yet: ')(error)
  }
}

// A pinned folder keeps its prefs to itself; every other folder shares the default.
async function savePrefs($: EngineInterface, prefs: Prefs): Promise<void> {
  if (!(await getPinned($))) {
    await $.store.set('prefs', prefs)

    return
  }

  const folders = parseFolders(await $.store.get('folders'), namesOf(await getTheme($)))
  await $.store.set('folders', withFolder(folders, await $.session.cwd(), prefs))
}

// Every change of prefs goes through here. A newly picked palette is selected
// with `theme colors`, so the terminal, Neovim and every other session follow.
export async function commit($: EngineInterface, prefs: Prefs): Promise<void> {
  const before = await getPrefs($)
  await setPrefs($, prefs)
  await savePrefs($, prefs)

  const theme = await getTheme($)

  if (theme === null || prefs.skin === 'off' || prefs.skin === before.skin || prefs.skin === theme.current) {
    return
  }

  const failed = await selectPalette($, theme.home, prefs.skin)

  if (failed === undefined) {
    await setTheme($, { ...theme, current: prefs.skin })
  } else {
    $.ui.toast(`theme colors ${prefs.skin} failed: ${failed}`)
  }
}

// /skin pin, unpin and share: this folder's own look, or the default.
export async function runFolderCommand($: EngineInterface, word: string): Promise<string> {
  const folder = await $.session.cwd()
  const theme = await getTheme($)
  const names = namesOf(theme)
  const folders = parseFolders(await $.store.get('folders'), names)
  const prefs = await getPrefs($)

  switch (word) {
    case 'pin':
      await $.store.set('folders', withFolder(folders, folder, prefs))
      await setPinned($, true)

      return 'this folder keeps its own look'
    case 'unpin': {
      const fallback = inCatalog(parsePrefs(await $.store.get('prefs'), names), theme)
      await $.store.set('folders', withoutFolder(folders, folder))
      await setPinned($, false)
      await setPrefs($, fallback)

      return `this folder follows the default: ${fallback.skin}`
    }
    default:
      await $.store.set('prefs', prefs)

      return `default look: ${prefs.skin}`
  }
}
