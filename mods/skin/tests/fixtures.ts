import type { Palette } from '../src/skins/skin'

// Sample palettes for the pure drawing tests: any full palette does, these have the
// properties some tests lean on (distinct hues, a colour shared by two slots).

export const TOKYO_NIGHT: Palette = {
  read: '#7dcfff',
  write: '#ff9e64',
  run: '#e0af68',
  search: '#bb9af7',
  web: '#7aa2f7',
  mcp: '#73daca',
  other: '#a9b1d6',
  user: '#7aa2f7',
  fg: '#c0caf5',
  muted: '#737aa2',
  surface: '#1f2335',
  zebra: '#1d2030',
  ok: '#9ece6a',
  err: '#f7768e',
  warn: '#e0af68',
}

// `read` and `ok` share a colour, `run` and `warn` another.
export const ROSE_PINE: Palette = {
  read: '#9ccfd8',
  write: '#ebbcba',
  run: '#f6c177',
  search: '#c4a7e7',
  web: '#3e8fb0',
  mcp: '#31748f',
  other: '#908caa',
  user: '#c4a7e7',
  fg: '#e0def4',
  muted: '#6e6a86',
  surface: '#26233a',
  zebra: '#1f1d2e',
  ok: '#9ccfd8',
  err: '#eb6f92',
  warn: '#f6c177',
}

export const DRACULA: Palette = {
  read: '#8be9fd',
  write: '#ffb86c',
  run: '#f1fa8c',
  search: '#bd93f9',
  web: '#ff79c6',
  mcp: '#50fa7b',
  other: '#f8f8f2',
  user: '#bd93f9',
  fg: '#f8f8f2',
  muted: '#6272a4',
  surface: '#2b2d3a',
  zebra: '#2a2c37',
  ok: '#50fa7b',
  err: '#ff5555',
  warn: '#f1fa8c',
}
