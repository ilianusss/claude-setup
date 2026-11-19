import { columnWidths, isShell, widthOf, wrapLines } from '../markdown/markdown'
import { diffFenceTag, diffRows, fenceDiff, newOnly } from '../markdown/diff-fence'
import { FOLD_ROWS, foldButton, shownCount } from './fold'
import type { Segment, Table } from '../markdown/markdown'
import { splitBlocks } from '../markdown/blocks'
import { artRows, chartRows } from './chart-rows'
import { chartArt } from '../charts/chart-art'
import { chartHeading, parseMermaid } from '../charts/mermaid'
import { mermaidArt } from '../charts/mermaid-art'
import type { Art } from '../charts/mermaid-art'
import type { Chart } from '../charts/mermaid'
import { blockRows } from './prose'
import type { DiffInput } from '../svg/svg-diff'
import { codeRows } from './code-rows'
import { languageOf } from '../markdown/highlight'
import { inlineMath } from '../math/math'
import { chartCard, codeCard, copyButton, copyRow, diffCard, mathCard, mathRows, onBorder, tableCard, tableControls } from './cards'
import type { Look, SvgElement, Ui } from './look'
import { CELL_PAD } from './rows'

const JUSTIFY = { left: 'flex-start', right: 'flex-end', center: 'center' } as const

// The share of the reported width a table may take at its natural size. Past it, the
// table spans its container and splits it between columns in proportion: the desktop
// app reports the window's width, wider than the transcript column a reply sits in.
const NATURAL_SHARE = 0.55

// A grid of cells, so columns line up in the terminal's monospace and in the desktop
// app's proportional font alike. `control`, such as a Copy button, sits on the frame's
// top border at the right, as ╭──── Copy ─╮.
// Past FOLD_ROWS rows it folds under `foldKey`. Long cells wrap within their column in
// full: unlike the desktop card, the terminal has no tooltip to read a cut cell by.
export function tableRows(look: Look, table: Table, maxWidth: number, control?: ReturnType<Ui['Button']>, foldKey = 'fold-table') {
  const { Box, Text } = look.ui
  const rows = table.rows.slice(0, shownCount(look, foldKey, table.rows.length, FOLD_ROWS))
  const { palette } = look.skin
  const widths = columnWidths(table, maxWidth - 4, CELL_PAD * 2)
  const natural = widths.reduce((sum, width) => sum + width + CELL_PAD * 2, 2)
  const isFluid = natural > maxWidth * NATURAL_SHARE
  // A fluid column grows from nothing, padding included, so its share counts the padding
  // too: by text width alone a narrow column gets less than it needs, or no room at all.
  const size = (i: number) =>
    isFluid
      ? { width: 0, flexGrow: (widths[i] ?? 0) + CELL_PAD * 2, flexShrink: 1 }
      : { width: (widths[i] ?? 0) + CELL_PAD * 2, flexShrink: 0 }
  const row = (cells: readonly string[], isHeader: boolean, band: string | undefined) => (
    <Box flexDirection="row" {...(band === undefined ? {} : { backgroundColor: band })}>
      {cells.map((cell, i) => (
        <Box {...size(i)} flexDirection="column" paddingX={CELL_PAD} alignItems={JUSTIFY[table.align[i] ?? 'left']}>
          {wrapLines(cell, widths[i] ?? 0, Infinity).map(line => (
            <Text color={palette.fg} bold={isHeader} wrap="truncate-end">
              {line}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )

  const fold = foldButton(look, foldKey, table.rows.length, FOLD_ROWS)
  const frame = onBorder(
    look,
    <Box flexDirection="column" borderStyle="round" borderColor={palette.muted}>
      {row(table.header, true, palette.surface)}
      {rows.map((cells, i) => row(cells, false, i % 2 === 1 ? palette.zebra : undefined))}
    </Box>,
    { control, box: { marginY: fold === '' ? 1 : 0, ...(isFluid ? { width: '100%' } : { alignSelf: 'flex-start' }) } },
  )

  return fold === '' ? (
    frame
  ) : (
    <Box flexDirection="column" marginY={1}>
      {frame}
      {fold}
    </Box>
  )
}

// One block of a reply, `maxWidth` columns wide.
function segmentRow(look: Look, segment: Segment, i: number, maxWidth: number, Svg?: SvgElement) {
  const { Box, Markdown } = look.ui

  if (segment.kind === 'text') {
    const text = look.prefs.math ? inlineMath(segment.text) : segment.text

    return look.prefs.markdown ? (
      <Box flexDirection="column">{blockRows(look, splitBlocks(text, { prose: look.surface === 'terminal' }))}</Box>
    ) : (
      <Markdown text={text} />
    )
  }

  if (segment.kind === 'math') {
    return Svg === undefined ? mathRows(look, segment.tex, maxWidth, `copy-${i}`) : mathCard(look, segment.tex, Svg, maxWidth, `copy-${i}`)
  }

  // A shell fence on the desktop stays the app's own block, which has Run and Copy.
  if (segment.kind === 'code' && Svg !== undefined && isShell(segment)) {
    return <Markdown text={segment.raw} />
  }

  if (segment.kind === 'code') {
    // A ```diff fence with changes in it is a diff, not code; ```diff-fsharp names its language.
    const tag = diffFenceTag(segment.lang)
    const diff = tag === null ? null : fenceDiff(segment.code)

    if (diff !== null) {
      return diffFence(look, diff, segment.code, maxWidth, i, Svg, tag?.lang)
    }

    const { chart, art } = drawingOf(look, segment, maxWidth, Svg)

    if (art !== null) {
      return (
        <Box flexDirection="column">
          {artRows(look, art, chart === null ? '' : chartHeading(chart).count)}
          {copyRow(look, `copy-${i}`, segment.code)}
        </Box>
      )
    }

    if (chart !== null && Svg !== undefined) {
      return chartCard(look, chart, segment.code, Svg, maxWidth, `copy-${i}`)
    }

    // A terminal too narrow for a drawing falls back to rows, or to the code.
    if (chart !== null && (chart.kind === 'flow' || chart.kind === 'xy' || chart.kind === 'pie')) {
      return (
        <Box flexDirection="column">
          {chartRows(look, chart, maxWidth)}
          {copyRow(look, `copy-${i}`, segment.code)}
        </Box>
      )
    }

    // The terminal highlights the languages it knows in the skin's colours.
    if (look.surface === 'terminal' && look.prefs.highlight && languageOf(segment.lang) !== undefined) {
      return codeRows(look, segment.lang, segment.code, copyButton(look, `copy-${i}`, segment.code), `fold-${i}`)
    }

    return Svg === undefined ? (
      <Box flexDirection="column">
        <Markdown text={segment.raw} />
        {copyRow(look, `copy-${i}`, segment.code)}
      </Box>
    ) : (
      codeCard(look, segment.lang, segment.code, Svg, maxWidth, `copy-${i}`, `fold-${i}`)
    )
  }

  return Svg === undefined ? (
    tableRows(look, segment, maxWidth, tableControls(look, `copy-${i}`, segment), `fold-${i}`)
  ) : (
    tableCard(look, segment, Svg, maxWidth, `copy-${i}`)
  )
}

// A Mermaid fence's chart, and on the terminal its drawing in cells: the kinds we parse in
// our own drawings, flowcharts, xy charts and the kinds we do not parse in the vendored one.
// Kept per segment for the draw that made it: laying a reply out measures a diagram
// before drawing it.
const drawings = new WeakMap<Segment, Map<string, { chart: Chart | null; art: Art | null }>>()

function drawingOf(look: Look, segment: Segment & { kind: 'code' }, maxWidth: number, Svg?: SvgElement) {
  const key = `${maxWidth}|${Svg === undefined}|${look.prefs.charts}|${look.prefs.icons}`
  const kept = drawings.get(segment)?.get(key)

  if (kept !== undefined) {
    return kept
  }

  const chart = segment.lang === 'mermaid' && look.prefs.charts ? parseMermaid(segment.code) : null
  const ascii = look.prefs.icons === 'ascii'
  const ours = Svg === undefined && chart !== null ? chartArt(chart, maxWidth, ascii) : null
  const vendored = Svg === undefined && segment.lang === 'mermaid' && look.prefs.charts && (chart === null || chart.kind === 'flow' || chart.kind === 'xy')
  const drawing = { chart, art: ours ?? (vendored ? mermaidArt(segment.code, maxWidth, ascii) : null) }

  drawings.set(segment, (drawings.get(segment) ?? new Map()).set(key, drawing))

  return drawing
}

// A diff fence: the diff card on the desktop, numbered rows on the terminal, with Copy for
// the fence and `new only` for the code as it stands after the change.
function diffFence(look: Look, diff: DiffInput, code: string, maxWidth: number, i: number, Svg?: SvgElement, fenceLang?: string) {
  const { Box } = look.ui
  const whole = copyButton(look, `copy-${i}`, code)
  const fresh = copyButton(look, `copy-${i}-new`, newOnly(diff), ' new only ')

  if (Svg !== undefined) {
    return (
      <Box flexDirection="column">
        {diffCard(look, Svg, diff, diff.path === '' ? 'diff' : diff.path, maxWidth)}
        <Box flexDirection="row" justifyContent="flex-end">
          {whole ?? ''}
          {fresh ?? ''}
        </Box>
      </Box>
    )
  }

  const controls =
    whole === undefined || fresh === undefined ? undefined : (
      <Box flexDirection="row">
        {whole}
        {fresh}
      </Box>
    )

  return diffRows(look, diff, controls, `fold-${i}`, fenceLang)
}

// Columns between blocks laid side by side.
const BESIDE_GAP = 2

// The narrowest a card may be drawn beside another on the desktop, in columns.
const BESIDE_MIN_CARD = 75

// How wide a block is when it may stand beside another: a table, or a drawn diagram. On
// the terminal its natural width in columns; on the desktop 0, for an even share. Null
// for any other block.
function besideWidth(look: Look, segment: Segment, maxWidth: number, Svg?: SvgElement): number | null {
  if (segment.kind === 'table') {
    return Svg !== undefined ? 0 : columnWidths(segment, maxWidth - 4, CELL_PAD * 2).reduce((sum, width) => sum + width + CELL_PAD * 2, 2)
  }

  if (segment.kind !== 'code' || segment.lang !== 'mermaid' || !look.prefs.charts) {
    return null
  }

  const { chart, art } = drawingOf(look, segment, maxWidth, Svg)

  if (Svg !== undefined) {
    return chart === null ? null : 0
  }

  // A drawing is laid out within two columns less than it is given (`chartArt`,
  // `mermaidArt`), so its place beside another block keeps those two.
  return art === null ? null : Math.max(...art.rows.map(row => row.reduce((sum, run) => sum + widthOf(run.text), 0))) + 2
}

type Placed = { segment: Segment; i: number; width: number }

// The reply's blocks in rows: a run of tables and diagrams with only blank text between
// them shares a row while the row has room; everything else, and a run that does not fit,
// stacks as before.
export function layoutRows(look: Look, segments: readonly Segment[], maxWidth: number, Svg?: SvgElement): Placed[][] {
  const rows: Placed[][] = []
  let run: Placed[] = []
  const flush = () => {
    rows.push(...packRun(run, maxWidth, Svg))
    run = []
  }

  for (const [i, segment] of segments.entries()) {
    const width = besideWidth(look, segment, maxWidth, Svg)

    if (width !== null) {
      run.push({ segment, i, width })
    } else if (!(segment.kind === 'text' && segment.text.trim() === '' && run.length > 0)) {
      flush()
      rows.push([{ segment, i, width: maxWidth }])
    }
  }

  flush()

  return rows
}

// Fills rows left to right; a block that does not fit starts the next row.
function packRun(run: readonly Placed[], maxWidth: number, Svg?: SvgElement): Placed[][] {
  if (Svg !== undefined) {
    const perRow = Math.max(1, Math.floor((maxWidth + BESIDE_GAP) / (BESIDE_MIN_CARD + BESIDE_GAP)))
    const rows: Placed[][] = []

    for (let at = 0; at < run.length; at += perRow) {
      const row = run.slice(at, at + perRow)
      const share = row.length === 1 ? maxWidth : Math.floor((maxWidth - BESIDE_GAP * (row.length - 1)) / row.length)
      rows.push(row.map(placed => ({ ...placed, width: share })))
    }

    return rows
  }

  const rows: Placed[][] = []
  let row: Placed[] = []
  let used = 0

  for (const placed of run) {
    const width = Math.min(placed.width, maxWidth)

    if (row.length > 0 && used + BESIDE_GAP + width > maxWidth) {
      rows.push(row)
      row = []
      used = 0
    }

    used += (row.length === 0 ? 0 : BESIDE_GAP) + width
    row.push({ ...placed, width: row.length === 0 && width === maxWidth ? maxWidth : width })
  }

  // A block alone on its row takes the whole width, as it would stacked.
  return [...rows, ...(row.length === 0 ? [] : [row])].map(placed => (placed.length === 1 ? placed.map(one => ({ ...one, width: maxWidth })) : placed))
}

// `whole`, the reply as Claude wrote it, adds a `copy reply` control under it.
export function replyRows(look: Look, segments: readonly Segment[], maxWidth: number, Svg?: SvgElement, whole?: string) {
  const { Box } = look.ui

  return (
    <Box flexDirection="column">
      {layoutRows(look, segments, maxWidth, Svg).map(row =>
        row.length === 1 ? (
          segmentRow(look, row[0]!.segment, row[0]!.i, maxWidth, Svg)
        ) : (
          <Box flexDirection="row" columnGap={BESIDE_GAP} alignItems="flex-start">
            {row.map(placed => (
              <Box flexDirection="column" flexShrink={0} {...(Svg === undefined ? { width: placed.width } : { width: 0, flexGrow: 1 })}>
                {segmentRow(look, placed.segment, placed.i, placed.width, Svg)}
              </Box>
            ))}
          </Box>
        ),
      )}
      {whole === undefined ? '' : copyRow(look, 'copy-reply', whole, 'copy reply')}
    </Box>
  )
}
