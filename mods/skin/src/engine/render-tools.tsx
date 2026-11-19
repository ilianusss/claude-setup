import type { On } from 'claude-code'

import { bodyOf, inputFields, isOpen } from '../tools/detail'
import { commandOf, errorLine, isQuiet, quietLabel } from '../tools/quiet'
import { keepsOwnRow, SHELLS, shellResultOf } from '../tools/shell'
import { kindOf, summarize, toolLabel } from '../tools/tools'
import { disclosedRow, openedRows } from '../ui/detail-rows'
import { diffCard, terminalCard } from '../ui/cards'
import { groupRow, quietResult, toolRow } from '../ui/rows'
import { OUTPUT_FOLD, shellRows } from '../ui/shell-rows'
import { touchOf } from '../markdown/links'
import { hunksOf } from '../svg/svg-diff'
import { shellOutputOf } from '../svg/svg-terminal'
import { clipLines, diffstat, shortenPath } from '../util/format'
import { drawingOf, firstDraws, withSettle } from './entrances'
import { activeSkin, copier, cwdOf, lookOf, sessionLook } from './look'
import { commandOfCall, disclosureOf, durationOf, isQuietOf, setDisclosureOf, setShowsAllOf, showsAllOf } from './state'

const CLIP_HEAD = 8
const CLIP_TAIL = 4

export const EDITS = new Set(['Edit', 'MultiEdit', 'Write'])

export function hookToolRenders(on: On): void {
  // What Claude Code's `isExpanded` read when a group was first drawn under `expand`.
  const groupStarts = new Map<string, boolean>()

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const kind = kindOf(e.props.tool)
    const active = await activeSkin($)

    if (kind === null || active === null) {
      return next(e)
    }

    const cwd = await cwdOf($)
    const ms = e.props.isRunning ? -1 : await durationOf($, e)
    const diff = diffstat(e.props.output)
    const target = summarize(e.props.tool, e.props.input, cwd)
    const meta = {
      ...(ms >= 0 && !e.props.isRunning ? { ms } : {}),
      ...(diff === null ? {} : diff),
    }
    const fields = (e.props.input ?? {}) as { file_path?: unknown; notebook_path?: unknown }
    const path = fields.file_path ?? fields.notebook_path
    // The chevron opens the row onto the call's input and its answer.
    const open = isOpen(await disclosureOf($, e), e.props.isErrored)
    const base = await sessionLook($, e, lookOf($.ui.resolve(e), active, e.surface, copier($, e.surface)), {
      touched: typeof path === 'string',
      folds: open,
      cwd,
    })
    const look = base.svg === undefined ? base : { ...base, isFirstDraw: await firstDraws($, e, active.prefs) }
    // A file this turn made or changed keeps its colour in every row that names it.
    const touch = typeof path === 'string' && look.touched !== undefined ? touchOf(look.touched.files, path, cwd) : undefined
    const label = active.prefs.quiet && isQuiet(e.props.tool, e.props.input) ? quietLabel(e.props.tool) : toolLabel(e.props.tool)
    const row = toolRow(look, e.props, kind, target, meta, label, touch)
    const toggle = () => void setDisclosureOf($, e, open ? 'closed' : 'open')

    if (!open) {
      return withSettle($, e, disclosedRow(look, row, false, toggle))
    }

    const isAll = await showsAllOf($, e)
    const opened = await openedRows(look, {
      fields: inputFields(e.props.tool, e.props.input, cwd),
      body: bodyOf(e.props.tool, e.props.output, e.props.isErrored, e.props.isRunning, cwd),
      command: commandOf(e.props.input),
      isErrored: e.props.isErrored,
      cwd,
      columns: e.viewport?.columns ?? 100,
      isAll,
      toggleAll: () => void setShowsAllOf($, e, !isAll),
      stock: () => next(e),
    })

    return withSettle($, e, disclosedRow(look, row, true, toggle, opened))
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const active = await activeSkin($)

    if (active === null) {
      return next(e)
    }

    const drawing = drawingOf(e)

    if (active.prefs.expand) {
      // expand opens every group as if the person had. A click moves Claude Code's flag off the
      // value it began at (folds), a second puts it back (opens again).
      const start = groupStarts.get(drawing) ?? e.props.isExpanded
      groupStarts.set(drawing, start)

      if (e.props.isExpanded === start) {
        return next({ ...e, props: { ...e.props, isExpanded: true } })
      }
    } else {
      groupStarts.delete(drawing)

      if (e.props.isExpanded) {
        return next(e)
      }
    }

    return groupRow(lookOf($.ui.resolve(e), active, e.surface), e.props.calls)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const active = await activeSkin($)
    const output = e.props.output as { stdout?: unknown } | null
    // Only the terminal's shell card has a fold control here.
    const needs = { folds: e.surface === 'terminal' && SHELLS.has(e.props.tool) }
    const look = active === null ? undefined : await sessionLook($, e, lookOf($.ui.resolve(e), active, e.surface, copier($, e.surface)), needs)
    const columns = e.viewport?.columns ?? 100
    // An opened row draws the answer itself; one it cannot draw keeps Claude Code's here.
    const isOpened =
      active !== null &&
      kindOf(e.props.tool) !== null &&
      isOpen(await disclosureOf($, e), e.props.isErrored) &&
      bodyOf(e.props.tool, e.props.output, e.props.isErrored, false, '').kind !== 'stock'

    if (isOpened) {
      const { Box } = $.ui.resolve(e)

      return <Box />
    }

    // Calm never folds a failure away: it is drawn whole, past quiet and the clip.
    const isCalmFailure = look !== undefined && look.prefs.calm !== null && e.props.isErrored

    // A call that only looked folds away; a failure keeps the line that says why.
    if (look !== undefined && look.prefs.quiet && !isCalmFailure && (await isQuietOf($, e))) {
      return quietResult(look, e.props.isErrored ? errorLine(e.props.output) : null)
    }

    // The desktop gets cards: a diff for an edit, a terminal for a shell command.
    if (look?.svg !== undefined && EDITS.has(e.props.tool) && !e.props.isErrored) {
      const diff = hunksOf(e.props.output)

      if (diff !== null) {
        const shown = shortenPath(diff.path, await $.session.cwd())

        return withSettle($, e, diffCard({ ...look, isFirstDraw: await firstDraws($, e, look.prefs) }, look.svg, diff, shown, columns))
      }
    }

    const isShellCard = look !== undefined && look.prefs.shell && SHELLS.has(e.props.tool) && !keepsOwnRow(e.props.output)

    if (look?.svg !== undefined && isShellCard) {
      const shell = shellOutputOf(e.props.output)

      if (shell !== null) {
        return withSettle($, e, terminalCard({ ...look, isFirstDraw: await firstDraws($, e, look.prefs) }, look.svg, shell, e.props.isErrored, columns))
      }
    }

    // The terminal's card is text: the command and its exit status, stderr apart, folded.
    if (look !== undefined && e.surface === 'terminal' && isShellCard) {
      const shell = shellResultOf(e.props.output, e.props.isErrored)

      if (shell !== null) {
        const isWhole = !look.prefs.fold || look.folds?.open.has(OUTPUT_FOLD) === true
        const fold = isWhole ? null : { head: CLIP_HEAD, tail: CLIP_TAIL }

        return shellRows(look, await commandOfCall($, e), shell, e.props.isErrored, {
          stdout: fold,
          stderr: isCalmFailure ? null : fold,
        })
      }
    }

    if (!active?.prefs.clipOutput || isCalmFailure || !SHELLS.has(e.props.tool) || typeof output?.stdout !== 'string') {
      return next(e)
    }

    const stdout = clipLines(output.stdout, CLIP_HEAD, CLIP_TAIL)

    return stdout === output.stdout ? next(e) : next({ ...e, props: { ...e.props, output: { ...output, stdout } } })
  })
}
