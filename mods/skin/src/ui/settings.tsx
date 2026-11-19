import type { ElementTable } from 'claude-code'

import type { ToggleWord } from '../prefs/command'
import { SLOTS } from '../skins/skin'
import type { Table } from '../markdown/markdown'
import { tableRows } from './reply-rows'
import { footerRow, groupRow, promptRow, toolRow } from './rows'
import type { Look } from './look'

export type PaneUi = Pick<ElementTable<'terminal' | 'desktop'>, 'Box' | 'Text' | 'Markdown' | 'Button'>

export type SettingsModel = {
  names: readonly string[]
  width: number
  // The palette file the colours come from: they are edited there, not here. Absent for the
  // default skin drawn without a theme home.
  colorsFrom?: string
}

export type SettingsActions = {
  pick: (name: string) => void
  toggle: (word: ToggleWord) => void
  calm: () => void
  tables: () => void
  icons: () => void
  prompt: () => void
  words: () => void
}

const SAMPLE: Table = {
  kind: 'table',
  header: ['Route', 'Limit', 'Window'],
  align: ['left', 'right', 'left'],
  rows: [
    ['/chat', '60', '1 min'],
    ['/upload', '10', '1 min'],
    ['/search', '120', '1 min'],
  ],
}

const done = { isRunning: false, isErrored: false, isInterrupted: false }

// A turn as the skin would draw it, built from the same rows the transcript uses.
function preview(look: Look, width: number) {
  const { Box } = look.ui
  const word = look.skin.done[0] ?? 'Done'

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={look.skin.palette.muted} paddingX={1}>
      {promptRow(look, 'add rate limiting to the hub api')}
      {toolRow(look, { tool: 'Bash', input: {}, ...done }, 'run', 'pnpm test --filter hub', { ms: 2140 })}
      {toolRow(look, { tool: 'Edit', input: {}, ...done }, 'write', 'apps/hub/src/server.ts', {
        ms: 380,
        added: 18,
        removed: 3,
      })}
      {groupRow(look, [
        { tool: 'Read', input: {}, ...done },
        { tool: 'Read', input: {}, ...done },
        { tool: 'Grep', input: {}, ...done },
      ])}
      {tableRows(look, SAMPLE, Math.max(20, width - 4))}
      {footerRow(look, word, 41_000, { tools: 6, added: 18, removed: 3 })}
    </Box>
  )
}

const mark = (on: boolean): string => (on ? '●' : '○')

export function settingsPane(look: Look, ui: PaneUi, model: SettingsModel, actions: SettingsActions) {
  const { Box, Text, Button } = ui
  const { palette } = look.skin
  const { prefs } = look
  const toggle = (word: ToggleWord, hotkey: string, on: boolean) => (
    <Button
      key={`toggle-${word}`}
      label={`${word} ${mark(on)}`}
      hotkey={hotkey}
      plain
      dimColor={!on}
      onPress={() => actions.toggle(word)}
    />
  )
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text color={palette.muted}>Skin</Text>
        {model.names.map((name, i) => (
          <Button
            key={`skin-${name}`}
            label={name === prefs.skin ? `${name} ●` : name}
            plain
            dimColor={name !== prefs.skin}
            onPress={() => actions.pick(name)}
            {...(i < 9 ? { hotkey: String(i + 1) } : {})}
          />
        ))}
      </Box>

      {preview(look, model.width)}

      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text color={palette.muted}>Look</Text>
        {toggle('rail', 'r', prefs.rail)}
        <Button
          key="tables"
          label={`tables ${prefs.tables}`}
          hotkey="t"
          plain
          dimColor={prefs.tables === 'off'}
          onPress={() => actions.tables()}
        />
        {toggle('shimmer', 's', prefs.shimmer)}
        {toggle('band', 'b', prefs.band)}
        {toggle('countdown', 'w', prefs.countdown)}
        {toggle('clip', 'c', prefs.clipOutput)}
        {toggle('markdown', 'm', prefs.markdown)}
        {toggle('quiet', 'q', prefs.quiet)}
        {toggle('charts', 'g', prefs.charts)}
        {toggle('math', 'x', prefs.math)}
        {toggle('commands', 'o', prefs.commands)}
        {toggle('shell', 'h', prefs.shell)}
        {toggle('highlight', 'y', prefs.highlight)}
        {toggle('hints', 'n', prefs.hints)}
        {toggle('links', 'l', prefs.links)}
        {toggle('copy', 'p', prefs.copy)}
        {toggle('fold', 'f', prefs.fold)}
        {toggle('expand', 'd', prefs.expand)}
        {toggle('compact', 'u', prefs.compact)}
        <Button key="calm" label={`calm ${mark(prefs.calm !== null)}`} hotkey="k" plain dimColor={prefs.calm === null} onPress={() => actions.calm()} />
        <Button key="icons" label={`icons ${prefs.icons}`} hotkey="i" plain onPress={() => actions.icons()} />
        <Button key="prompt" label={`prompt ${prefs.prompt}`} hotkey="a" plain onPress={() => actions.prompt()} />
        <Button key="words" label={`words ${prefs.words}`} hotkey="e" plain onPress={() => actions.words()} />
      </Box>

      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {SLOTS.map(slot => (
            <Text>
              <Text backgroundColor={palette[slot]}>{'  '}</Text>
              <Text color={palette.muted}>{` ${slot}`}</Text>
            </Text>
          ))}
        </Box>
        {model.colorsFrom === undefined ? (
          <Text color={palette.muted}>No theme home: set SKIN_THEME_HOME to a folder with colors/.</Text>
        ) : (
          <Text color={palette.muted}>
            Colours come from <Text color={palette.fg}>{model.colorsFrom}</Text>: set {'claude_<slot>'} keys there.
          </Text>
        )}
      </Box>

      <Text color={palette.muted}>Esc closes.</Text>
    </Box>
  )
}
