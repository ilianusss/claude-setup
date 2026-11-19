import type { EngineInterface, RenderSurface } from 'claude-code'

import type { Prefs } from '../../types'
import { hyperlinksFrom } from '../markdown/links'
import { skinOf } from '../skins/catalog'
import { ICONS } from '../skins/skin'
import type { Look, SvgElement, Ui } from '../ui/look'
import { foldsOf, getPrefs, getTheme, getTouched, live, toggleFoldOf } from './state'
import type { Active } from './state'

// The skin to draw with; null while the skin is off.
export async function activeSkin($: EngineInterface): Promise<Active | null> {
  const prefs = await getPrefs($)
  const skin = skinOf(prefs.skin, await getTheme($))

  return skin === undefined ? null : { prefs, skin }
}

export async function cwdOf($: EngineInterface): Promise<string> {
  return live.cwd ?? (await $.session.cwd())
}

// Every surface's element table names Svg, but the terminal draws it as nothing.
export const lookOf = (ui: Ui & { Svg?: SvgElement }, active: Active, surface: RenderSurface, copy?: (text: string) => void): Look => ({
  ui,
  skin: active.skin,
  icons: ICONS[active.prefs.icons],
  prefs: active.prefs,
  surface,
  ...(surface !== 'terminal' && ui.Svg !== undefined ? { svg: ui.Svg } : {}),
  ...(copy === undefined || !active.prefs.copy ? {} : { copy }),
})

// Cards as vector drawings where the surface draws them and tables are `on`.
export const cardSvg = (ui: object, surface: RenderSurface, prefs: Prefs): SvgElement | undefined =>
  surface !== 'terminal' && prefs.tables === 'on' && 'Svg' in ui ? (ui.Svg as SvgElement) : undefined

export function copier($: EngineInterface, surface: RenderSurface): (text: string) => void {
  return text => {
    void $.ui.copy({ text, surface }).then(result => $.ui.toast(result.isCopied ? 'Copied' : 'Could not copy here'))
  }
}

// What a drawing adds from the session. Each is a read on every draw, so a drawing asks only
// for what it can show.
export type Needs = { links?: boolean; touched?: boolean; folds?: boolean; cwd?: string }

export async function sessionLook($: EngineInterface, e: { requestId: string; surface: RenderSurface }, look: Look, needs: Needs): Promise<Look> {
  const links = needs.links === true && look.prefs.links && (e.surface !== 'terminal' || live.hyperlinks)
  const touched = needs.touched === true && live.hasTouched ? { files: await getTouched($), cwd: needs.cwd ?? (await cwdOf($)) } : undefined
  const open = needs.folds === true && look.prefs.fold ? new Set(await foldsOf($, e)) : undefined

  return {
    ...look,
    links,
    ...(touched === undefined ? {} : { touched }),
    ...(open === undefined
      ? {}
      : {
          folds: {
            open,
            toggle: (key: string) => void toggleFoldOf($, e, key),
          },
        }),
  }
}

// What a reply's blocks can show: links where it has a URL, file colours where it names a
// path, fold controls where it has code or a table.
export const replyNeeds = (text: string, segments: readonly { kind: string }[]): Needs => ({
  links: /https?:\/\//.test(text),
  touched: /[\w.-]\/[\w.-]|\w\.[A-Za-z]{1,5}\b/.test(text),
  folds: segments.some(segment => segment.kind === 'code' || segment.kind === 'table'),
})

export async function readHyperlinks($: EngineInterface): Promise<void> {
  // Each name spelled out: the engine lists the variables a module reads from its source.
  live.hyperlinks = hyperlinksFrom({
    FORCE_HYPERLINK: await $.env.get('FORCE_HYPERLINK'),
    TERM_PROGRAM: await $.env.get('TERM_PROGRAM'),
    TERM_PROGRAM_VERSION: await $.env.get('TERM_PROGRAM_VERSION'),
    TERM: await $.env.get('TERM'),
    WT_SESSION: await $.env.get('WT_SESSION'),
    VTE_VERSION: await $.env.get('VTE_VERSION'),
    KONSOLE_VERSION: await $.env.get('KONSOLE_VERSION'),
    TMUX: await $.env.get('TMUX'),
    CI: await $.env.get('CI'),
  })
}
