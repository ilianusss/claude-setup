import { widthOf } from '../markdown/markdown'
import { settled } from '../svg/svg-kit'
import { metersKey, trackColor, usageLine, usageSvg } from '../svg/svg-usage'
import type { Meter } from '../svg/svg-usage'
import type { Look } from './look'

// From this full, the band suggests compacting and makes it the main action.
export const COMPACT_NUDGE = 70

export const COMPACT_HOTKEY = '0'

// Claude Code lays the band out clear of its collapse mark ([-]) from 2.1.289; before that the
// band keeps the mark's five columns clear itself. A version it cannot read is a newer build's.
export function markGutter(version: string | undefined): number {
  const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '')

  if (parts === null) {
    return 0
  }

  const [major, minor, patch] = parts.slice(1).map(Number) as [number, number, number]

  return major * 1_000_000 + minor * 1000 + patch < 2_001_289 ? 5 : 0
}

// One drawing or line per meter, each with the columns it takes on the terminal, so the band
// can pack them into lines. Whether the rings fill in is still decided once for the whole band,
// keyed on every meter, so they fill together when any number changes and hold still together
// otherwise.
function meterSections(look: Look, meters: readonly Meter[]) {
  const { Text } = look.ui
  const { palette } = look.skin

  if (look.svg !== undefined) {
    const Svg = look.svg
    const builds = meters.map(meter => ({ meter, built: usageSvg([meter], palette, true) }))
    const entranceMs = Math.max(0, ...builds.map(({ built }) => built.entranceMs))
    const isFirst = look.isFirstDraw === undefined || look.isFirstDraw(`usage:${metersKey(meters)}`, entranceMs)

    return builds.map(({ meter, built }) => ({
      width: 0,
      view: <Svg key={`usage-${meter.label}`} source={isFirst ? built.source : settled(built.source)} alt={built.alt} width={built.width} height={built.height} />,
    }))
  }

  // A bar on its track, so its whole length shows; the cache's meter is its words alone.
  return usageLine(meters, palette).map(meter =>
    meter.bar === ''
      ? { width: widthOf(meter.text), view: <Text color={meter.color}>{meter.text}</Text> }
      : {
          width: widthOf(meter.bar) + 2 + widthOf(meter.text),
          view: (
            <Text color={palette.muted}>
              <Text color={meter.color} backgroundColor={trackColor(palette)}>
                {meter.bar}
              </Text>
              {`  ${meter.text}`}
            </Text>
          ),
        },
  )
}

// What a separator and the gaps either side of it take between two sections.
const SEPARATOR_COLUMNS = 5

// Sections into lines of at most `width` columns, in order, each line as full as it goes.
export function packLines(widths: readonly number[], width: number): number[][] {
  const lines: number[][] = []
  let used = 0

  widths.forEach((columns, i) => {
    const line = lines.at(-1)

    if (line !== undefined && used + SEPARATOR_COLUMNS + columns <= width) {
      line.push(i)
      used += SEPARATOR_COLUMNS + columns
    } else {
      lines.push([i])
      used = columns
    }
  })

  return lines
}

// The Compact button that becomes the main action, with a word on why, once the context is
// full enough to be worth it, and the columns it takes on the terminal.
function compactSection(look: Look, context: number, compact: () => void) {
  const { Box, Text, Button } = look.ui
  const { palette } = look.skin
  const isNudge = context >= COMPACT_NUDGE
  const nudge = `Context is ${context}% full`
  const label = isNudge ? 'Compact now' : 'Compact'
  // A digit hotkey: typed alone into an empty prompt it presses the band's button, which
  // is the only way in where the terminal reports no clicks. `plain` shows it: `0: Compact`.
  const button = (
    <Button
      key="compact"
      label={label}
      hotkey={COMPACT_HOTKEY}
      plain
      {...(isNudge ? { variant: 'primary' as const } : { dimColor: true })}
      onPress={compact}
    />
  )

  return {
    width: (isNudge ? widthOf(nudge) + 2 : 0) + widthOf(`${COMPACT_HOTKEY}: ${label}`),
    view: (
      <Box flexDirection="row" alignItems="center" columnGap={2}>
        {[...(isNudge ? [<Text color={palette.warn}>{nudge}</Text>] : []), button]}
      </Box>
    ),
  }
}

const contextOf = (meters: readonly Meter[]): number => meters.find(meter => meter.label === 'context')?.percent ?? 0

// The terminal's Compact nudge above the prompt, centred: the band's digit hotkeys work there
// and not in the footer under the prompt. Only once the context is full enough to be worth it.
export function compactRow(look: Look, meters: readonly Meter[], compact: () => void, gutter = 0) {
  const { Box } = look.ui
  const context = contextOf(meters)

  return context < COMPACT_NUDGE ? undefined : (
    <Box flexDirection="row" justifyContent="center" marginRight={gutter}>
      {compactSection(look, context, compact).view}
    </Box>
  )
}

// The usage band: a plain bar with round corners, everything in it centred, a `│` between its
// sections. The meters, then, where `canCompact`, the Compact button and its nudge (see
// compactSection); `/skin compact off` drops them. Given its `width`, the band takes it whole
// and packs its sections into lines itself, so a line never starts or ends on a separator;
// without, it is one row that wraps where it must. `gutter` columns stay clear past the bar's
// right end, for a collapse mark the engine draws there (see markGutter). A blank row sits
// between lines, packed or wrapped, so they do not run together.
export function usageBand(
  look: Look,
  meters: readonly Meter[],
  canCompact: boolean,
  compact: () => void,
  layout: { gutter?: number; width?: number } = {},
) {
  const { Box, Text } = look.ui
  const { palette } = look.skin
  const gutter = layout.gutter ?? 0
  const sections = [...meterSections(look, meters), ...(canCompact ? [compactSection(look, contextOf(meters), compact)] : [])]
  // The border and the padding inside it take four columns.
  const lines = layout.width === undefined ? [sections.map((_, i) => i)] : packLines(sections.map(section => section.width), layout.width - 4)
  const row = (line: readonly number[]) => (
    <Box flexDirection="row" flexWrap="wrap" alignItems="center" justifyContent="center" columnGap={2} rowGap={1}>
      {line.flatMap((index, i) => [...(i === 0 ? [] : [<Text color={palette.muted}>│</Text>]), sections[index]?.view])}
    </Box>
  )

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.muted}
      paddingX={1}
      rowGap={1}
      marginRight={gutter}
      {...(layout.width === undefined ? {} : { width: layout.width })}
    >
      {lines.map(row)}
    </Box>
  )
}
