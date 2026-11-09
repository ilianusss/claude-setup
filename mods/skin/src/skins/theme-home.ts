import type { SkinSlot } from '../../types'
import { mix } from '../util/colour'
import { DEFAULT_SKIN } from './default-skin'
import type { Palette, Skin } from './skin'

// Every palette in <theme home>/colors/<name>/palette is a skin (docs/theme-home.md).
// A palette is `key="value"` lines; zsh and Neovim parse the same grammar, so keep it that simple.

export type Palettes = Readonly<Record<string, string>>

export type { ThemeHome } from '../../types'

const LINE = /^\s*([A-Za-z0-9_]+)=(.*)$/
const HEX = /^#[0-9a-f]{6}$/i
const BASES = Array.from({ length: 16 }, (_, i) => `base0${i.toString(16).toUpperCase()}`)

export function parsePalette(text: string): Palettes {
  const keys: Record<string, string> = {}

  for (const line of text.split('\n')) {
    const match = LINE.exec(line)

    if (match !== null) {
      const rest = match[2] ?? ''
      keys[match[1] ?? ''] = /^"([^"]*)"/.exec(rest)?.[1] ?? /^(\S*)/.exec(rest)?.[1] ?? ''
    }
  }

  return keys
}

// The base16 slot each skin slot takes.
export const DERIVED: Readonly<Record<Exclude<SkinSlot, 'zebra'>, string>> = {
  fg: 'base05',
  muted: 'base04',
  surface: 'base01',
  user: 'base0D',
  ok: 'base0B',
  err: 'base08',
  warn: 'base09',
  read: 'base0D',
  write: 'base09',
  run: 'base0B',
  search: 'base0E',
  web: 'base0C',
  mcp: 'base0A',
  other: 'base04',
}

const colour = (keys: Palettes, key: string): string | undefined => {
  const value = keys[key]?.toLowerCase()

  return value !== undefined && HEX.test(value) ? value : undefined
}

function derived(keys: Palettes): Palette | undefined {
  if (BASES.some(base => colour(keys, base) === undefined)) {
    return undefined
  }

  const at = (base: string) => colour(keys, base) ?? '#000000'
  const slots = Object.fromEntries(Object.entries(DERIVED).map(([slot, base]) => [slot, at(base)]))

  return { ...slots, zebra: mix(at('base00'), at('base01'), 0.5) } as Palette
}

// `claude_spinner="Purring, Napping"`: words, comma-separated since one may hold a space.
const words = (value: string | undefined): string[] =>
  (value ?? '').split(',').map(word => word.trim()).filter(word => word !== '')

// A palette's skin: derived from base16, then each `claude_<slot>` key over it, and the words
// of `claude_spinner` and `claude_done`, else the default skin's. Undefined when a base16 key
// is missing.
export function paletteSkin(name: string, keys: Palettes): Skin | undefined {
  const from = derived(keys)

  if (from === undefined) {
    return undefined
  }

  const own = Object.fromEntries(
    Object.keys(from).flatMap(slot => {
      const hex = colour(keys, `claude_${slot}`)

      return hex === undefined ? [] : [[slot, hex]]
    }),
  )
  const spinner = words(keys.claude_spinner)
  const done = words(keys.claude_done)

  return {
    name,
    label: keys.name ?? name,
    palette: { ...from, ...own } as Palette,
    spinner: spinner.length > 0 ? spinner : DEFAULT_SKIN.spinner,
    done: done.length > 0 ? done : DEFAULT_SKIN.done,
  }
}

// The palette folder a `current/colors` link resolves to: `/x/.theme/colors/kanagawa` → `kanagawa`.
export const folderName = (path: string | undefined): string | null =>
  path === undefined ? null : (path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) ?? null)

// `~/x` and `$HOME/x` against the home directory; anything else as given.
export function expandHome(path: string, home: string | undefined): string {
  const trimmed = path.trim()

  if (home === undefined) {
    return trimmed
  }

  return trimmed.replace(/^(~|\$HOME|\$\{HOME\})(?=$|[\\/])/, home)
}
