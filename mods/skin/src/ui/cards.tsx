import { tableArt } from '../markdown/markdown'
import { FOLD_CODE, foldButton, shownCount } from './fold'
import type { Table } from '../markdown/markdown'
import type { Chart } from '../charts/mermaid'
import { chartSvg } from '../charts/svg-chart'
import { codeSvg } from '../svg/svg-code'
import { diffSvg } from '../svg/svg-diff'
import type { DiffInput } from '../svg/svg-diff'
import { cardWidth, settled } from '../svg/svg-kit'
import { tableSvg } from '../svg/svg-table'
import { terminalSvg } from '../svg/svg-terminal'
import type { ShellOutput } from '../svg/svg-terminal'
import { mathArt, parseTex } from '../math/math'
import { mathSvg } from '../math/svg-math'
import type { Look, SvgElement, Ui } from './look'

// A card's source: animated on its first draw, settled on every draw after it.
const sourceOf = (look: Look, key: string, built: { source: string; entranceMs: number }): string =>
  look.isFirstDraw === undefined || look.isFirstDraw(key, built.entranceMs) ? built.source : settled(built.source)

// A card drawn as an image, with its Copy button laid over the top-right corner the card
// left free. The image cannot be pressed, so the button is a real one on top of it; the
// box hugs the image so the corner is the card's, not the column's. The image takes the
// markup's own size, so one drawn wider than the reply column is scaled down to fit it.
function cardWithCopy(look: Look, Svg: SvgElement, built: { source: string; alt: string; entranceMs: number }, key: string, text: string) {
  const { Box, Button } = look.ui
  const copy = look.copy

  return (
    <Box marginY={1} alignSelf="flex-start">
      <Svg source={sourceOf(look, key, built)} alt={built.alt} />
      {copy === undefined ? (
        ''
      ) : (
        <Box position="absolute" top={1} right={3}>
          <Button key={key} label="Copy" plain dimColor onPress={() => copy(text)} />
        </Box>
      )}
    </Box>
  )
}

// Copy takes the markdown; `as text` under the card takes the table as drawn.
export function tableCard(look: Look, table: Table, Svg: SvgElement, columns: number, key: string) {
  const { Box } = look.ui
  const card = tableSvg(table, look.skin.palette, cardWidth(columns), look.copy !== undefined)

  return (
    <Box flexDirection="column">
      {cardWithCopy(look, Svg, card, key, tableMarkdown(table))}
      {copyRow(look, `${key}-art`, tableArt(table), 'Copy as text')}
    </Box>
  )
}

// The table's two copies on its frame: markdown, and the table as drawn.
export function tableControls(look: Look, key: string, table: Table) {
  const { Box } = look.ui
  const markdown = copyButton(look, key, tableMarkdown(table))
  const art = copyButton(look, `${key}-art`, tableArt(table), ' as text ')

  return markdown === undefined || art === undefined ? undefined : (
    <Box flexDirection="row">
      {markdown}
      {art}
    </Box>
  )
}

export function mathCard(look: Look, tex: string, Svg: SvgElement, columns: number, key: string) {
  const card = mathSvg(tex, look.skin.palette, cardWidth(columns), look.copy !== undefined)

  return cardWithCopy(look, Svg, card, key, tex.trim())
}

// A formula in cells: stacked fractions, radicals and tall brackets, one Text per row.
export function mathRows(look: Look, tex: string, maxWidth: number, key: string) {
  const { Box, Text } = look.ui
  const { palette } = look.skin

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color={palette.muted} bold>
        MATH
      </Text>
      <Box flexDirection="column" marginTop={1} paddingLeft={2}>
        {mathArt(parseTex(tex), Math.max(10, maxWidth - 2)).map(row => (
          <Text color={palette.fg}>{row === '' ? ' ' : row}</Text>
        ))}
      </Box>
      {copyRow(look, key, tex.trim())}
    </Box>
  )
}

// A table as markdown again, for the clipboard.
const tableMarkdown = (table: Table): string =>
  [table.header, table.header.map(() => '---'), ...table.rows].map(cells => `| ${cells.join(' | ')} |`).join('\n')

// A frame with a label and a control on its top border. They are laid over it from a plain
// Box around the frame, not from inside it: inside a bordered Box, Windows Terminal drew the
// border over them. `box` sizes the plain Box the way the frame should sit.
export function onBorder(
  look: Look,
  frame: ReturnType<Ui['Box']>,
  parts: { label?: ReturnType<Ui['Text']>; control?: ReturnType<Ui['Button']> | ReturnType<Ui['Box']>; box?: Record<string, unknown> },
) {
  const { Box } = look.ui

  return (
    <Box flexDirection="column" {...parts.box}>
      {frame}
      {parts.label === undefined ? (
        ''
      ) : (
        <Box position="absolute" top={0} left={2}>
          {parts.label}
        </Box>
      )}
      {parts.control === undefined ? (
        ''
      ) : (
        <Box position="absolute" top={0} right={2}>
          {parts.control}
        </Box>
      )}
    </Box>
  )
}

// A Copy button padded to sit on a border line; nothing where nothing can copy.
export function copyButton(look: Look, key: string, text: string, label = ' Copy ') {
  const { Button } = look.ui
  const copy = look.copy

  return copy === undefined ? undefined : <Button key={key} label={label} plain dimColor onPress={() => copy(text)} />
}

// A small Copy button under a card or block, flush right; nothing where nothing can copy.
export function copyRow(look: Look, key: string, text: string, label = 'Copy') {
  const { Box, Button } = look.ui
  const copy = look.copy

  if (copy === undefined) {
    return ''
  }

  return (
    <Box flexDirection="row" justifyContent="flex-end">
      <Button key={key} label={label} plain dimColor onPress={() => copy(text)} />
    </Box>
  )
}

// A vector card in a reply or under a tool row, a line's breath above and below it.
function card(look: Look, Svg: SvgElement, built: { source: string; alt: string; entranceMs: number }, key: string) {
  const { Box } = look.ui

  return (
    <Box marginY={1}>
      <Svg source={sourceOf(look, key, built)} alt={built.alt} />
    </Box>
  )
}

// Past FOLD_CODE lines the card is cut there, with `▾ N more` under it; opened, it runs to
// the card's own 80-line cap.
export function codeCard(look: Look, lang: string, code: string, Svg: SvgElement, columns: number, key = 'copy-code', foldKey = `${key}-fold`) {
  const { Box } = look.ui
  const count = code.split('\n').length
  const shown = shownCount(look, foldKey, count, FOLD_CODE)
  const card = cardWithCopy(look, Svg, codeSvg(code, lang, look.skin.palette, cardWidth(columns), look.copy !== undefined, shown === count ? undefined : shown), key, code)

  return look.folds === undefined || count <= FOLD_CODE ? (
    card
  ) : (
    <Box flexDirection="column">
      {card}
      {foldButton(look, foldKey, count, FOLD_CODE)}
    </Box>
  )
}

// A chart too crowded to draw at this width keeps its source as a code card.
export function chartCard(look: Look, chart: Chart, source: string, Svg: SvgElement, columns: number, key: string) {
  const built = chartSvg(chart, look.skin.palette, cardWidth(columns), look.copy !== undefined)

  return built === null ? codeCard(look, 'mermaid', source, Svg, columns, key) : cardWithCopy(look, Svg, built, key, source)
}

export function diffCard(look: Look, Svg: SvgElement, input: DiffInput, shownPath: string, columns: number) {
  return card(look, Svg, diffSvg(input, shownPath, look.skin.palette, cardWidth(columns)), 'diff')
}

export function terminalCard(look: Look, Svg: SvgElement, output: ShellOutput, isErrored: boolean, columns: number, key = 'copy-output') {
  const text = [output.stdout, output.stderr].filter(part => part.trim() !== '').join('\n')
  const withCopy = text === '' ? { ...look, copy: undefined } : look

  return cardWithCopy(withCopy, Svg, terminalSvg(output, isErrored, look.skin.palette, cardWidth(columns), withCopy.copy !== undefined, look.prefs.highlight), key, text)
}
