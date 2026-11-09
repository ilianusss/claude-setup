import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { runSkinCommand, DEFAULT_PREFS } from '../src/prefs/command'
import { fallbackOf, kindOf, namesOf, skinOf } from '../src/skins/catalog'
import { DEFAULT_SKIN } from '../src/skins/default-skin'
import { mix } from '../src/util/colour'
import { expandHome, folderName, paletteSkin, parsePalette } from '../src/skins/theme-home'
import type { ThemeHome } from '../src/skins/theme-home'

const BASE16 = `
base00="#282828"
base01="#32302f"
base02="#504945"
base03="#665c54"
base04="#bdae93"
base05="#d4be98"
base06="#ebdbb2"
base07="#fbf1c7"
base08="#ea6962"
base09="#e78a4e"
base0A="#d8a657"
base0B="#a9b665"
base0C="#89b482"
base0D="#7daea3"
base0E="#d3869b"
base0F="#bd6f3e"
`

const palette = (head: string) => `# a palette\n${head}\n${BASE16}`

test('a palette parses quoted and bare values and skips comments', () => {
  const keys = parsePalette('# Gruvbox — https://x\nname="Gruvbox Material"\nvariant=dark\nbase00="#282828"   # bg\nnvim_colorscheme=gruvbox\n  # claude_skin=nope\n')

  expect(keys).toEqual({ name: 'Gruvbox Material', variant: 'dark', base00: '#282828', nvim_colorscheme: 'gruvbox' })
})

test('a palette without claude_skin derives every slot from base16', () => {
  const skin = paletteSkin('gruvbox-material-dark', parsePalette(palette('name="Gruvbox Material Dark"\nvariant=dark')))

  expect(skin?.name).toBe('gruvbox-material-dark')
  expect(skin?.label).toBe('Gruvbox Material Dark')
  expect(skin?.palette).toEqual({
    fg: '#d4be98',
    muted: '#bdae93',
    surface: '#32302f',
    zebra: mix('#282828', '#32302f', 0.5),
    user: '#7daea3',
    ok: '#a9b665',
    err: '#ea6962',
    warn: '#e78a4e',
    read: '#7daea3',
    write: '#e78a4e',
    run: '#a9b665',
    search: '#d3869b',
    web: '#89b482',
    mcp: '#d8a657',
    other: '#bdae93',
  })
  expect(skin?.spinner).toEqual(DEFAULT_SKIN.spinner)
  expect(skin?.done).toEqual(DEFAULT_SKIN.done)
})

test('claude_<slot> keys override the derived colours, and claude_skin names nothing any more', () => {
  const derived = paletteSkin('g', parsePalette(palette('variant=dark')))
  const skin = paletteSkin('g', parsePalette(palette('variant=dark\nclaude_skin=gruvbox\nclaude_user="#FF0000"\nclaude_nope="#00ff00"\nclaude_run=red')))

  expect(skin?.palette).toEqual({ ...derived?.palette, user: '#ff0000' })
})

test('claude_spinner and claude_done give the words, comma-separated', () => {
  const skin = paletteSkin('c', parsePalette(palette('claude_spinner="Purring, Napping,,Pouncing"\nclaude_done="Pounced,Curled up"')))

  expect(skin?.spinner).toEqual(['Purring', 'Napping', 'Pouncing'])
  expect(skin?.done).toEqual(['Pounced', 'Curled up'])
  expect(paletteSkin('e', parsePalette(palette('claude_spinner=""')))?.spinner).toEqual(DEFAULT_SKIN.spinner)
})

test('a palette missing a base16 key, or with a bad hex, is no skin', () => {
  expect(paletteSkin('broken', parsePalette('name="Broken"\nbase00="#000000"'))).toBeUndefined()
  expect(paletteSkin('bad-hex', parsePalette(palette('').replace('"#282828"', '"282828"')))).toBeUndefined()
})

test('the selected palette is the last part of the resolved link, and ~ expands against HOME', () => {
  expect(folderName('/Users/me/.theme/colors/kanagawa-paper-ink')).toBe('kanagawa-paper-ink')
  expect(folderName('C:\\Users\\me\\.theme\\colors\\nord\\')).toBe('nord')
  expect(folderName(undefined)).toBeNull()
  expect(expandHome('~/.theme', '/Users/me')).toBe('/Users/me/.theme')
  expect(expandHome('$HOME/.theme', '/Users/me')).toBe('/Users/me/.theme')
  expect(expandHome('/opt/theme', '/Users/me')).toBe('/opt/theme')
  expect(expandHome('~other/.theme', '/Users/me')).toBe('~other/.theme')
})

test('the catalog is the theme home\'s palettes, or miasma alone without one', () => {
  const paper = paletteSkin('paper', parsePalette(palette('variant=light')))
  const miasma = paletteSkin('miasma', parsePalette(palette('variant=dark')))
  const theme: ThemeHome = { home: '/t', skins: [paper, miasma].flatMap(skin => (skin === undefined ? [] : [skin])), current: 'paper' }

  expect(DEFAULT_PREFS.skin).toBe('miasma')
  expect(namesOf(null)).toEqual(['miasma'])
  expect(skinOf('miasma', null)).toEqual(DEFAULT_SKIN)
  expect(namesOf(theme)).toEqual(['paper', 'miasma'])
  expect(skinOf('noir', theme)).toBeUndefined()
  expect(skinOf('miasma', theme)?.palette).toEqual(miasma?.palette)
  expect([kindOf(null), kindOf(theme)]).toEqual(['built in', 'theme palette'])
  expect(fallbackOf(null)).toBe('miasma')
  expect(fallbackOf(theme)).toBe('paper')
  expect(fallbackOf({ ...theme, current: null }), 'no selection: miasma when the home has it').toBe('miasma')
  expect(fallbackOf({ ...theme, skins: theme.skins.slice(0, 1), current: null })).toBe('paper')
})

test('/skin on turns the fallback skin back on', () => {
  const off = { ...DEFAULT_PREFS, skin: 'off' }

  expect(runSkinCommand('on', off, ['paper'], 'paper').prefs.skin).toBe('paper')
  expect(runSkinCommand('on', off, ['miasma']).prefs.skin).toBe(DEFAULT_PREFS.skin)
})

const SITE = { plugin: 'skin', viewport: { columns: 100, rows: 30 } } as const
const STOCK: RenderElement = { type: 'Text', props: {}, children: ['stock row'] }

const bashRow = (id: string) =>
  ({
    ...SITE,
    surface: 'terminal',
    component: 'ToolUse',
    requestId: id,
    props: { tool_use_id: id, tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false },
  }) as const

type Found = { props: Record<string, unknown>; children?: readonly unknown[] } | undefined

function spanColor(row: Found, text: string): unknown {
  for (const child of row?.children ?? []) {
    const element = child as { props?: { color?: unknown }; children?: readonly unknown[] }

    if (element.children?.[0] === text) {
      return element.props?.color
    }

    const inner = spanColor(element as Found, text)

    if (inner !== undefined) {
      return inner
    }
  }

  return undefined
}

async function bashColor($: Engine, id: string): Promise<unknown> {
  const row = await $.ui.mount(bashRow(id))
  const color = spanColor((await row.find({ type: 'Text', text: /Bash/ })) as Found, 'Bash')
  await row.unmount()

  return color
}

const runSkin = ($: Engine, args: string) =>
  $.command.run({ command: 'skin', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

// A file system of plain text files and folders, with mtimes the test moves.
function fakeFs(on: On, files: Record<string, string>, links: Record<string, string> = {}) {
  const mtimes: Record<string, number> = {}
  const writes: string[] = []
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/'))
  // Windows resolves a path before it reaches the hook: drop the drive and the backslashes.
  const at = (path: string) => path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

  on('fs.read', ($, e) => {
    const text = files[at(e.path)]

    if (text === undefined) {
      throw new Error(`ENOENT ${at(e.path)}`)
    }

    return { value: text }
  })
  on('fs.write', ($, e) => {
    files[at(e.path)] = e.text
    mtimes[at(e.path)] = (mtimes[at(e.path)] ?? 0) + 1
    writes.push(at(e.path))
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: Object.keys(files).some(path => path === at(e.path) || path.startsWith(`${at(e.path)}/`)) }))
  on('fs.list', ($, e) => {
    const names = new Map<string, 'file' | 'dir'>()

    for (const path of Object.keys(files)) {
      if (path.startsWith(`${at(e.path)}/`)) {
        const [name = '', ...rest] = path.slice(at(e.path).length + 1).split('/')
        names.set(name, rest.length === 0 ? 'file' : 'dir')
      }
    }

    if (names.size === 0) {
      throw new Error(`ENOENT ${at(e.path)}`)
    }

    return {
      value: [...names].map(([name, kind]) => ({ name, kind, size: files[`${at(e.path)}/${name}`]?.length ?? 0, mtimeMs: mtimes[`${at(e.path)}/${name}`] ?? 0, isLink: false })),
    }
  })
  on('fs.stat', ($, e) => {
    const target = links[at(e.path)]

    if (target === undefined && files[at(e.path)] === undefined) {
      throw new Error(`ENOENT ${at(e.path)}`)
    }

    return { value: { kind: target === undefined ? 'file' : 'dir', size: 0, mtimeMs: mtimes[at(e.path)] ?? 0, isLink: target !== undefined, ...(target === undefined ? {} : { realPath: target }) } }
  })

  return {
    files,
    writes,
    touch: (path: string) => {
      mtimes[path] = (mtimes[path] ?? 0) + 1
      files[parentOf(path)] ??= ''
    },
  }
}

const exited = (exitCode: number, stderr = '') => ({ value: { exitCode, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

// Only `theme` answers: the appearance probes (defaults, reg, gsettings) find nothing here.
const onlyTheme = (argv: readonly string[], exitCode = 0, stderr = '') => (argv[0]?.endsWith('/bin/theme') === true ? exited(exitCode, stderr) : exited(127))

function stubSession(on: On, env: Record<string, string | undefined>, own: { toast?: boolean } = {}) {
  const clock = mock.clock(on, { now: 10_000 })
  on('session.cwd', () => ({ value: '/work' }))
  on('env.get', ($, e) => ({ value: env[e.name] }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  if (!own.toast) {
    on('ui.toast', () => ({ value: undefined }))
  }
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.log', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 42 }, rateLimits: [] } }))
  on('ui.render', () => STOCK)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: { command: 'skin' } }))
  on('config.list', () => ({ value: [] }))

  return clock
}

const HOME = '/t'
const themeFiles = (home = HOME) => ({
  [`${home}/colors/gruvbox-material-dark/palette`]: palette('name="Gruvbox Material Dark"\nvariant=dark'),
  [`${home}/colors/homebrew-dark/palette`]: palette('name="Homebrew Dark"\nvariant=dark\nclaude_skin=homebrew\nclaude_run="#123456"'),
  [`${home}/generated/stamp`]: 'gruvbox-material-dark jetbrains-mono\n',
})

test('the theme home lists only its palettes, draws the selected one, and /skin <palette> runs theme colors', async ($, on) => {
  stubSession(on, { SKIN_THEME_HOME: HOME, HOME: '/home/me' })
  const fs = fakeFs(on, themeFiles(), { [`${HOME}/current/colors`]: `${HOME}/colors/gruvbox-material-dark` })
  const ran: { argv: readonly string[]; env?: Record<string, string> }[] = []
  on('process.run', ($, e) => {
    ran.push({ argv: e.argv, ...(e.init?.env === undefined ? {} : { env: e.init.env }) })
    return onlyTheme(e.argv)
  })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  expect(await bashColor($, 'a')).toBe('#a9b665')

  const listed = (await runSkin($, 'list')).text ?? ''
  expect(listed).toMatch(/\| gruvbox-material-dark \(current\) +\| theme palette +\|/)
  expect(listed).toMatch(/\| homebrew-dark +\| theme palette +\|/)
  expect(listed).not.toMatch(/\| noir /)
  expect(listed).toMatch(/\| skins from +\| \/t\/colors +\|/)
  expect((await runSkin($, 'noir')).text).toMatch(/unknown skin "noir"/)

  await runSkin($, 'homebrew-dark')
  expect(ran.filter(run => run.argv[0] === `${HOME}/bin/theme`)).toEqual([{ argv: [`${HOME}/bin/theme`, 'colors', 'homebrew-dark'], env: { THEME_HOME: HOME } }])
  expect(await bashColor($, 'b')).toBe('#123456')
  expect(fs.writes).toEqual([])
})

test('the skin follows a theme switched elsewhere, and /skin off stays off', async ($, on) => {
  const clock = stubSession(on, { HOME: '/home/me' })
  on('settings.read', () => ({ value: { env: { SKIN_THEME_HOME: '~/theme' } } as never }))
  const home = '/home/me/theme'
  const links = { [`${home}/current/colors`]: `${home}/colors/gruvbox-material-dark` }
  const fs = fakeFs(on, themeFiles(home), links)
  on('process.run', ($, e) => onlyTheme(e.argv))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(await bashColor($, 'a')).toBe('#a9b665')

  links[`${home}/current/colors`] = `${home}/colors/homebrew-dark`
  fs.touch(`${home}/generated/stamp`)
  await clock.advance(2000)
  expect(await bashColor($, 'b')).toBe('#123456')

  await runSkin($, 'off')
  links[`${home}/current/colors`] = `${home}/colors/gruvbox-material-dark`
  fs.touch(`${home}/generated/stamp`)
  await clock.advance(2000)
  const row = await $.ui.mount(bashRow('c'))
  expect(await row.find({ type: 'Text', text: 'stock row' })).toBeDefined()
})

test('a failing theme command is told in a toast and the selection stays', async ($, on) => {
  stubSession(on, { SKIN_THEME_HOME: HOME }, { toast: true })
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  fakeFs(on, themeFiles(), { [`${HOME}/current/colors`]: `${HOME}/colors/gruvbox-material-dark` })
  on('process.run', ($, e) => onlyTheme(e.argv, 1, 'theme: no colors x\n'))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await runSkin($, 'homebrew-dark')

  expect(toasts).toContain('theme colors homebrew-dark failed: theme: no colors x')
})

test('the settings pane offers every palette and picks one with theme colors', async ($, on) => {
  stubSession(on, { SKIN_THEME_HOME: HOME })
  fakeFs(on, themeFiles(), { [`${HOME}/current/colors`]: `${HOME}/colors/gruvbox-material-dark` })
  const ran: (readonly string[])[] = []
  on('process.run', ($, e) => {
    ran.push(e.argv)
    return onlyTheme(e.argv)
  })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const pane = await $.ui.mount({ ...SITE, surface: 'terminal', component: 'Pane', requestId: 'skin-settings', props: { title: 'Skin', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
  expect(await pane.find({ key: 'skin-gruvbox-material-dark' })).toBeDefined()
  expect(await pane.find({ key: 'skin-more' })).toBeUndefined()
  await pane.press({ key: 'skin-homebrew-dark' })
  await pane.unmount()

  expect(ran).toContainEqual([`${HOME}/bin/theme`, 'colors', 'homebrew-dark'])
  expect(await bashColor($, 'a')).toBe('#123456')
})

test('without a theme home, miasma draws and is the only skin', async ($, on) => {
  stubSession(on, { HOME: '/home/me' })
  fakeFs(on, {})
  on('process.run', () => exited(127))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  expect(await bashColor($, 'a')).toBe(DEFAULT_SKIN.palette.run)
  const listed = (await runSkin($, 'list')).text ?? ''
  expect(listed).toMatch(/\| miasma \(current\) +\| built in +\|/)
  expect(listed).not.toMatch(/\| noir /)
})
