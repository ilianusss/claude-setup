import { DEFAULT_PREFS } from '../prefs/command'
import { DEFAULT_SKIN } from './default-skin'
import type { Skin } from './skin'
import type { ThemeHome } from './theme-home'

// Which skins exist: the theme home's palettes, or the default skin alone without one.

export const namesOf = (theme: ThemeHome | null): string[] =>
  theme === null ? [DEFAULT_SKIN.name] : theme.skins.map(skin => skin.name)

export const skinOf = (name: string, theme: ThemeHome | null): Skin | undefined =>
  theme === null ? (name === DEFAULT_SKIN.name ? DEFAULT_SKIN : undefined) : theme.skins.find(skin => skin.name === name)

// The skin `/skin on` and a missing skin fall back to: the theme home's selection, else the
// default when the home has it, else its first palette.
export function fallbackOf(theme: ThemeHome | null): string {
  if (theme === null) {
    return DEFAULT_PREFS.skin
  }

  return theme.current ?? (namesOf(theme).includes(DEFAULT_PREFS.skin) ? DEFAULT_PREFS.skin : (theme.skins[0]?.name ?? DEFAULT_PREFS.skin))
}

export const kindOf = (theme: ThemeHome | null): string => (theme === null ? 'built in' : 'theme palette')
