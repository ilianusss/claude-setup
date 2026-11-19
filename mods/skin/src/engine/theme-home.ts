import type { EngineInterface, Timer } from 'claude-code'

import { expandHome, folderName, paletteSkin, parsePalette } from '../skins/theme-home'
import type { ThemeHome } from '../skins/theme-home'
import type { Skin } from '../skins/skin'
import { messageOf } from '../util/format'
import { debugLog } from './state'

// The theme home (docs/theme-home.md): SKIN_THEME_HOME, when it names a folder with colors/. The
// skins are its palettes; `theme colors` moves it, and its generated/stamp tells us it moved.
const POLL_MS = 2000
const THEME_TIMEOUT_MS = 15_000

let stamp: number | undefined
let poller: Timer | undefined

// The process's environment first, then the `env` of Claude Code's settings.
export async function themeHomeOf($: EngineInterface): Promise<string | undefined> {
  const env = await $.settings.read({ key: 'env' }).catch(() => undefined)
  const configured = typeof env === 'object' && env !== null ? (env as Record<string, unknown>).SKIN_THEME_HOME : undefined
  const raw = (await $.env.get('SKIN_THEME_HOME')) ?? (typeof configured === 'string' ? configured : undefined)

  if (raw === undefined || raw.trim() === '') {
    return undefined
  }

  const home = expandHome(raw, (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))).replace(/[\\/]+$/, '')

  return (await $.fs.exists(`${home}/colors`).catch(() => false)) ? home : undefined
}

export async function loadThemeHome($: EngineInterface, home: string): Promise<ThemeHome> {
  const folders = (await $.fs.list(`${home}/colors`))
    .filter(entry => entry.kind === 'dir' || entry.isLink)
    .map(entry => entry.name)
    .sort()
  const skins: Skin[] = []

  for (const name of folders) {
    const text = await $.fs.read(`${home}/colors/${name}/palette`).catch(() => undefined)
    const skin = text === undefined ? undefined : paletteSkin(name, parsePalette(text))

    if (skin === undefined) {
      debugLog($, `palette ${name}: `)('no palette file, or base00..base0F missing')
    } else {
      skins.push(skin)
    }
  }

  const link = await $.fs.stat(`${home}/current/colors`, { resolve: true }).catch(() => undefined)
  const current = folderName(link?.realPath)
  stamp = await stampOf($, home)

  return { home, skins, current: skins.some(skin => skin.name === current) ? current : null }
}

async function stampOf($: EngineInterface, home: string): Promise<number | undefined> {
  return (await $.fs.stat(`${home}/generated/stamp`).catch(() => undefined))?.mtimeMs
}

// `theme apply` rewrites generated/stamp; a new stamp reloads the palettes and the selection.
export function watchThemeHome($: EngineInterface, home: string, moved: (theme: ThemeHome) => Promise<void>): void {
  poller?.cancel()
  poller = $.clock.every(POLL_MS, () => {
    void (async () => {
      const now = await stampOf($, home)

      if (now !== stamp) {
        stamp = now
        await moved(await loadThemeHome($, home))
      }
    })().catch(debugLog($, 'theme home: '))
  })
}

export function stopThemeHome(): void {
  poller?.cancel()
  poller = undefined
}

// Runs `theme colors <name>`, which themes every tool. Undefined when it worked, else why not.
export async function selectPalette($: EngineInterface, home: string, name: string): Promise<string | undefined> {
  const ran = await $.process
    .run([`${home}/bin/theme`, 'colors', name], { env: { THEME_HOME: home }, timeoutMs: THEME_TIMEOUT_MS })
    .catch((error: unknown) => ({ exitCode: -1, stderr: messageOf(error) }))

  return ran.exitCode === 0 ? undefined : ran.stderr.trim() || `theme exited with ${ran.exitCode}`
}
