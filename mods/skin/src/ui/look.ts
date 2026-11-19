import type { ElementTable, RenderSurface } from 'claude-code'

import type { Prefs, Touch } from '../../types'
import type { Icons, Skin } from '../skins/skin'

export type Ui = Pick<ElementTable, 'Box' | 'Text' | 'Markdown' | 'Button' | 'Code' | 'Link'>

// The vector element, on the surfaces that have one (the desktop app).
export type SvgElement = ElementTable<'desktop'>['Svg']

export type Look = {
  ui: Ui
  skin: Skin
  icons: Icons
  prefs: Prefs
  surface: RenderSurface
  // The vector element where the surface draws one: icons replace glyphs there.
  svg?: SvgElement
  // Puts text on the clipboard of the surface drawing; absent where nothing can copy.
  copy?: (text: string) => void
  // True the first time this drawing shows the card by that key; a card drawn again is
  // drawn settled. Absent, every card animates.
  isFirstDraw?: (key: string, entranceMs: number) => boolean
  // Bare URLs drawn as links: the terminal's OSC 8, the desktop's anchors. Absent, text.
  links?: boolean
  // The files this turn created or edited, by absolute path, and the folder paths are under.
  touched?: { files: Readonly<Record<string, Touch>>; cwd: string }
  // The blocks the person unfolded, by key, and how to flip one. Absent, nothing folds.
  folds?: { open: ReadonlySet<string>; toggle: (key: string) => void }
}

export type Call = {
  tool: string
  input: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
}

// What a tool row shows at its right edge.
export type Meta = { ms?: number; added?: number; removed?: number }
