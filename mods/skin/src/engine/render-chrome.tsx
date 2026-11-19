import type { On } from 'claude-code'

import { compactRow, usageBand } from '../ui/band'
import { askBand, desktopSpinnerRow, footerRow, spinnerRow } from '../ui/rows'
import { pick } from '../util/format'
import { firstDraws, withSettle } from './entrances'
import { activeSkin, lookOf } from './look'
import { getFrame, getStarted, getTurns } from './state'
import type { Turn } from './state'
import { compactControl, metersNow } from './usage'

// What the terminal's hint row under the prompt leaves of its width: two columns before, three after.
const HINT_INSET = 5

// Around the transcript: the spinner, the turn footer, the usage band and the question band.
export function hookChromeRenders(on: On, turn: Turn): void {
  // The terminal's spinner gets the skin's word with a shimmer; the desktop's keeps its word,
  // which says what the step is doing, beside an animated icon.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const active = await activeSkin($)

    if (active === null) {
      return next(e)
    }

    if (e.surface !== 'terminal') {
      const look = lookOf($.ui.resolve(e), active, e.surface)

      // Calm keeps the app's own, quieter spinner.
      return look.svg === undefined || active.prefs.calm !== null
        ? next(e)
        : desktopSpinnerRow(look, look.svg, e.props.mode, e.props.message ?? e.props.word)
    }

    const word = active.prefs.words === 'claude' ? e.props.word : (pick(active.skin.spinner, e.props.word) ?? e.props.word)

    if (!active.prefs.shimmer || e.props.message !== null) {
      return next({ ...e, props: { ...e.props, word } })
    }

    const frame = await getFrame($)
    const startedAt = await getStarted($)
    const elapsed = startedAt === 0 ? 0 : (await $.clock.now()) - startedAt

    return spinnerRow(lookOf($.ui.resolve(e), active, e.surface), word, frame, elapsed)
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const active = await activeSkin($)

    if (active === null) {
      return next(e)
    }

    const turns = await getTurns($)
    const word = active.prefs.words === 'claude' ? e.props.word : (pick(active.skin.done, e.props.word) ?? e.props.word)

    return footerRow(lookOf($.ui.resolve(e), active, e.surface), word, e.props.durationMs, turns[String(e.props.durationMs)])
  })

  // The usage band: above the prompt on the desktop; on the terminal it is the footer under the
  // prompt (PromptHint), and only the Compact nudge stays here, where its digit hotkey works.
  // Another mod's drawing here, and a survey, keep their place.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const active = await activeSkin($)
    const meters = await metersNow($, active)

    if (active === null || !active.prefs.band || e.props.hasSurvey || meters.length === 0) {
      return next(e)
    }

    const plain = lookOf($.ui.resolve(e), active, e.surface)
    const { Box } = plain.ui
    const { canCompact, compact } = await compactControl($, active, e.props.isWorking)

    if (e.surface === 'terminal') {
      const nudge = canCompact ? compactRow(plain, meters, compact, turn.gutter) : undefined

      if (nudge === undefined) {
        return next(e)
      }

      const theirs = await next(e)

      return (
        <Box flexDirection="column">
          {nudge}
          {theirs}
        </Box>
      )
    }

    const theirs = await next(e)
    const look = { ...plain, ...(plain.svg === undefined ? {} : { isFirstDraw: await firstDraws($, e, active.prefs) }) }

    return withSettle(
      $,
      e,
      <Box flexDirection="column">
        {usageBand(look, meters, canCompact, compact, { gutter: turn.gutter })}
        {theirs}
      </Box>,
    )
  })

  // The terminal's footer: Claude Code's own hint line, then the usage band packed into lines.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const active = await activeSkin($)
    const meters = e.surface === 'terminal' ? await metersNow($, active) : []

    if (active === null || !active.prefs.band || meters.length === 0) {
      return next(e)
    }

    const look = lookOf($.ui.resolve(e), active, e.surface)
    const { Box } = look.ui
    const theirs = await next(e)

    return (
      <Box flexDirection="column">
        {theirs}
        {usageBand(look, meters, false, () => undefined, e.viewport === undefined ? {} : { width: e.viewport.columns - HINT_INSET })}
      </Box>
    )
  })

  // Claude Code's own dialog stays whole: the skin only adds a band above it.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const active = await activeSkin($)
    const theirs = await next(e)

    if (active === null) {
      return theirs
    }

    const headers = e.props.questions
      .map(question => (question as { header?: unknown } | null)?.header)
      .filter((header): header is string => typeof header === 'string' && header !== '')
    const look = lookOf($.ui.resolve(e), active, e.surface)
    const { Box } = look.ui

    return headers.length === 0 ? (
      theirs
    ) : (
      <Box flexDirection="column">
        {askBand(look, headers)}
        {theirs}
      </Box>
    )
  })
}
