import type { Skin } from './skin'

// The skin drawn without a theme home: ~/.theme's miasma palette as paletteSkin builds it.
// Its words are also those of every palette that names none.
export const DEFAULT_SKIN: Skin = {
  name: 'miasma',
  label: 'Miasma',
  palette: {
    fg: '#c2c2b0',
    muted: '#94948b',
    surface: '#1c1c1c',
    zebra: '#1f1f1f',
    user: '#78824b',
    ok: '#5f875f',
    err: '#b36d43',
    warn: '#bb7744',
    read: '#78824b',
    write: '#bb7744',
    run: '#5f875f',
    search: '#bb7744',
    web: '#c9a554',
    mcp: '#d7c483',
    other: '#94948b',
  },
  spinner: ['Thinking', 'Working', 'Composing', 'Considering', 'Weighing'],
  done: ['Done', 'Finished', 'Settled'],
}
