import type { Touch, TurnStats } from '../../types'
import { formatDuration, formatMs } from '../util/format'
import { MAX_MARKDOWN } from '../markdown/reply'
import type { Kind } from '../skins/skin'
import { copyButton, onBorder } from './cards'
import { spinnerColor, spinnerIcon, toolIcon } from './icons'
import type { SpinnerMode } from './icons'
import { kindOf, toolLabel } from '../tools/tools'
import type { Call, Look, Meta, SvgElement, Ui } from './look'

const KIND_LABEL: Readonly<Record<Kind, string>> = {
  read: 'Read',
  write: 'Edit',
  run: 'Run',
  search: 'Search',
  web: 'Web',
  mcp: 'MCP',
  other: 'Other',
}

export const CELL_PAD = 1

// The worst thing that happened to any of the calls, else how far along they are.
function status({ skin, icons }: Look, calls: readonly Call[]) {
  if (calls.some(call => call.isInterrupted)) {
    return { glyph: icons.interrupted, color: skin.palette.warn }
  }

  if (calls.some(call => call.isErrored)) {
    return { glyph: icons.err, color: skin.palette.err }
  }

  if (calls.some(call => call.isRunning)) {
    return { glyph: icons.running, color: skin.palette.muted }
  }

  return { glyph: icons.ok, color: skin.palette.ok }
}

// The connector above a node, which ties a turn's calls into one line down the left.
function railLine(look: Look) {
  const { Text } = look.ui

  return <Text color={look.skin.palette.user}>{look.icons.rail}</Text>
}

function node(look: Look, calls: readonly Call[]) {
  const { Text } = look.ui
  const { glyph, color } = status(look, calls)
  const branch = look.prefs.rail && look.surface === 'terminal' ? look.icons.branch : ''

  return (
    <Text color={color}>
      {`${glyph}`}
      <Text color={look.skin.palette.muted}>{`${branch} `}</Text>
    </Text>
  )
}

function metaSpans(look: Look, meta: Meta) {
  const { Text } = look.ui
  const { palette } = look.skin
  const spans = []

  if (meta.added !== undefined && meta.removed !== undefined && meta.added + meta.removed > 0) {
    spans.push(<Text color={palette.ok}>{`+${meta.added}`}</Text>)
    spans.push(<Text color={palette.err}>{` −${meta.removed}`}</Text>)
  }

  if (meta.ms !== undefined) {
    spans.push(<Text color={palette.muted}>{`${spans.length > 0 ? '  ' : ''}${formatMs(meta.ms)}`}</Text>)
  }

  return spans
}

// A line with its facts flush right on the terminal and trailing it on the desktop,
// which lays a row out its own way.
function withMeta(look: Look, main: ReturnType<Ui['Text']>, meta: Meta) {
  const { Box, Text } = look.ui
  const spans = metaSpans(look, meta)

  if (spans.length === 0) {
    return main
  }

  if (look.surface !== 'terminal') {
    return (
      <Text wrap="truncate-end">
        {main}
        {'   '}
        {spans}
      </Text>
    )
  }

  return (
    <Box flexDirection="row">
      <Box flexGrow={1} flexShrink={1}>
        {main}
      </Box>
      <Box flexShrink={0} paddingLeft={2}>
        <Text>{spans}</Text>
      </Box>
    </Box>
  )
}

function stack(look: Look, line: ReturnType<Ui['Text']>) {
  const { Box } = look.ui

  // Box-drawing rails need a monospace font, which only the terminal draws mod text in.
  return look.prefs.rail && look.surface === 'terminal' ? (
    <Box flexDirection="column">
      {railLine(look)}
      {line}
    </Box>
  ) : (
    line
  )
}

// On a surface with vector icons, the icon leads the row in place of the status glyph.
function iconRow(look: Look, Svg: SvgElement, kind: Kind, calls: readonly Call[], line: ReturnType<Ui['Text']>) {
  const { Box } = look.ui
  const { color } = status(look, calls)
  // Calm keeps a running icon still.
  const source = toolIcon(kind, color, look.prefs.calm === null && calls.some(call => call.isRunning))

  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      <Svg source={source} alt={kind} width={16} height={16} />
      {line}
    </Box>
  )
}

// `touch` colours the target of a file this turn created (ok) or edited (warn).
export function toolRow(look: Look, call: Call, kind: Kind, target: string, meta: Meta, label = toolLabel(call.tool), touch?: Touch) {
  const { Text } = look.ui
  const { palette } = look.skin
  const targetColor = call.isErrored ? palette.err : touch === 'created' ? palette.ok : touch === 'edited' ? palette.warn : palette.muted

  if (look.svg !== undefined) {
    const line = (
      <Text wrap="truncate-end">
        <Text color={palette[kind]} bold>
          {label}
        </Text>
        <Text color={targetColor}>{`  ${target}`}</Text>
      </Text>
    )

    return iconRow(look, look.svg, kind, [call], withMeta(look, line, meta))
  }

  const main = (
    <Text wrap="truncate-end">
      {node(look, [call])}
      <Text color={palette[kind]}>{label}</Text>
      <Text color={targetColor}>{`  ${target}`}</Text>
    </Text>
  )

  return stack(look, withMeta(look, main, meta))
}

// A quiet call's result: nothing when it worked, the one line that says why when it failed.
export function quietResult(look: Look, failure: string | null) {
  const { Box, Text } = look.ui

  return failure === null ? (
    <Box />
  ) : (
    <Text color={look.skin.palette.err} wrap="truncate-end">{`${look.prefs.icons === 'ascii' ? 'x' : '✖'} ${failure}`}</Text>
  )
}

// A run of reads and searches on one node: `●─ Read 3 · Search 2 ▸`. The `▸` is plain text,
// not a button: a click anywhere on the line is Claude Code's, and opens the group.
export function groupRow(look: Look, calls: readonly Call[]) {
  const { Text } = look.ui
  const { palette } = look.skin
  const counts = new Map<Kind, number>()

  for (const call of calls) {
    const kind = kindOf(call.tool) ?? 'other'
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }

  const parts = [...counts].flatMap(([kind, count], i) => [
    ...(i === 0 ? [] : [<Text color={palette.muted}>{' · '}</Text>]),
    <Text color={palette[kind]}>{KIND_LABEL[kind]}</Text>,
    <Text color={palette.muted}>{` ${count}`}</Text>,
  ])

  parts.push(<Text color={palette.muted} dimColor>{look.prefs.icons === 'ascii' ? '  >' : '  ▸'}</Text>)

  if (look.svg !== undefined) {
    const lead = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other'

    return iconRow(look, look.svg, lead, calls, <Text wrap="truncate-end">{parts}</Text>)
  }

  return stack(
    look,
    <Text wrap="truncate-end">
      {node(look, calls)}
      {parts}
    </Text>,
  )
}

// The desktop's spinner row: an animated icon for what the turn is doing, beside the
// step the desktop names (`Creating notes.md`).
export function desktopSpinnerRow(look: Look, Svg: SvgElement, mode: SpinnerMode, text: string) {
  const { Box, Text } = look.ui

  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      <Svg source={spinnerIcon(mode, spinnerColor(mode, look.skin.palette))} alt={mode} width={20} height={20} />
      <Text color={look.skin.palette.muted}>{text}</Text>
    </Box>
  )
}

// Markdown reads a prompt's marks as formatting, so each ASCII mark is escaped to show as
// typed and each line break becomes a hard break. Leading spaces become no-break spaces,
// which indent the same without turning the line into a code block. Brackets and
// parentheses are character references instead: escaped, `\(` and `\[` open math in the
// desktop app's Markdown, whether or not `/skin math` is on.
const REFERENCES: Readonly<Record<string, string>> = { '(': '&#40;', ')': '&#41;', '[': '&#91;', ']': '&#93;' }

export const literal = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[!-\/:-@\[-`{-~]/g, mark => REFERENCES[mark] ?? `\\${mark}`).replace(/^ +/, spaces => ' '.repeat(spaces.length)))
    .join('  \n')

const COPY_LABEL = ' Copy '

// Your message in a rounded outline sized to what you typed, so it stands apart from
// replies without taking the full width. Images it carried follow below it, drawn by
// Claude Code. `/skin prompt right` puts it on the right, where the desktop app draws it,
// and `/skin prompt plain` drops the outline for the skin's prompt marker.
// Copy sits on the outline's top border, or after the text when the prompt is plain.
// On the desktop app the text is the app's own Markdown, which can be selected and copied;
// a prompt too long for one Markdown block keeps the Text.
export function promptRow(look: Look, text: string, images?: ReturnType<Ui['Text']>) {
  const { Box, Markdown, Text } = look.ui
  const markdown = look.surface === 'terminal' ? null : literal(text)
  const plain = look.prefs.prompt === 'plain'
  const copy = copyButton(look, 'copy-prompt', text, COPY_LABEL)
  const body = [
    plain ? <Text color={look.skin.palette.user}>{`${look.icons.prompt} `}</Text> : '',
    markdown === null || markdown.length > MAX_MARKDOWN ? <Text color={look.skin.palette.fg}>{text}</Text> : <Markdown text={markdown} />,
  ]

  return (
    <Box flexDirection="column" alignItems={look.prefs.prompt === 'right' ? 'flex-end' : 'flex-start'} marginY={1}>
      {plain ? (
        <Box flexShrink={1}>
          {body}
          {copy ?? ''}
        </Box>
      ) : (
        onBorder(
          look,
          // Wide enough that a short prompt's border still has room for Copy and both corners.
          <Box borderStyle="round" borderColor={look.skin.palette.muted} paddingX={1} flexShrink={1} {...(copy === undefined ? {} : { minWidth: COPY_LABEL.length + 4 })}>
            {body}
          </Box>,
          { control: copy, box: { flexShrink: 1 } },
        )
      )}
      {images ?? ''}
    </Box>
  )
}

// The word with a band of light sweeping through it, one letter a frame.
export function spinnerRow(look: Look, word: string, frame: number, elapsedMs: number) {
  const { Text } = look.ui
  const { palette } = look.skin
  const letters = [...word]
  const head = (frame % (letters.length + 8)) - 4
  const shade = (i: number): string => {
    const distance = Math.abs(i - head)

    return distance === 0 ? palette.fg : distance === 1 ? palette.user : palette.muted
  }
  const runs: { color: string; text: string }[] = []

  for (const [i, letter] of letters.entries()) {
    const color = shade(i)
    const last = runs.at(-1)

    if (last?.color === color) {
      last.text += letter
    } else {
      runs.push({ color, text: letter })
    }
  }

  return (
    <Text>
      <Text color={palette.user}>{`${look.icons.frames[frame % look.icons.frames.length] ?? ''} `}</Text>
      {runs.map(run => (
        <Text color={run.color}>{run.text}</Text>
      ))}
      <Text color={palette.muted}>{`…  ${formatDuration(elapsedMs)}`}</Text>
    </Text>
  )
}

export function footerRow(look: Look, word: string, durationMs: number, stats: TurnStats | undefined) {
  const { Text } = look.ui
  const { palette } = look.skin
  const facts = [
    ...(stats === undefined || stats.tools === 0 ? [] : [`${stats.tools} tool${stats.tools === 1 ? '' : 's'}`]),
  ]
  const hasDiff = stats !== undefined && stats.added + stats.removed > 0

  return (
    <Text color={palette.muted}>
      <Text color={palette.user}>{`${look.icons.done} `}</Text>
      {`${word} in ${formatDuration(durationMs)}`}
      {facts.length > 0 ? `  ·  ${facts.join('  ·  ')}` : ''}
      {hasDiff ? '  ·  ' : ''}
      {hasDiff ? <Text color={palette.ok}>{`+${stats.added}`}</Text> : ''}
      {hasDiff ? <Text color={palette.err}>{` −${stats.removed}`}</Text> : ''}
    </Text>
  )
}

// A band above Claude Code's own question dialog: the topics it asks about, in the skin.
export function askBand(look: Look, headers: readonly string[]) {
  const { Text } = look.ui
  const { palette } = look.skin

  return (
    <Text color={palette.muted}>
      <Text color={palette.user}>{`${look.icons.prompt} `}</Text>
      {headers.map((header, i) => (
        <Text color={i === 0 ? palette.fg : palette.muted} bold={i === 0}>
          {`${i === 0 ? '' : '  ·  '}${header}`}
        </Text>
      ))}
    </Text>
  )
}
