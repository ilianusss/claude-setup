import type { EngineInterface, On } from 'claude-code'

import { CHART_HINT } from '../charts/mermaid'
import { commandSegments } from '../markdown/command-output'
import { MAX_MARKDOWN, replySegments } from '../markdown/reply'
import { replyRows } from '../ui/reply-rows'
import { promptRow } from '../ui/rows'
import { firstDraws, withSettle } from './entrances'
import { activeSkin, cardSvg, copier, lookOf, replyNeeds, sessionLook } from './look'
import { debugLog, hasImagesOf } from './state'
import type { Turn } from './state'

// A longer prompt keeps Claude Code's own drawing, which folds a big paste.
const MAX_PROMPT = 4000

// Only a person's own typing becomes a prompt row: a task notification or a peer's message is
// not theirs to dress as theirs.
const TYPED = new Set(['composer', 'bridge', 'sdk'])

// Whether the skin-code mod draws this reply's code in a VS Code theme. A missing mod shows as
// the call itself throwing (normal, says nothing); a failure inside it is logged.
async function drawnBySkinCode($: EngineInterface, text: unknown): Promise<boolean> {
  if (typeof text !== 'string') {
    return false
  }

  let answer: Promise<boolean>

  try {
    answer = $.skinCode!.draws({ text })
  } catch {
    return false
  }

  try {
    return (await answer) === true
  } catch (error) {
    debugLog($, 'skin-code did not answer, so skin draws the reply: ')(error)

    return false
  }
}

export function hookReplyRenders(on: On, turn: Turn): void {
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const active = await activeSkin($)

    // Off the terminal your messages keep Claude Code's component: copy, rewind, context menu
    // and selectable text, which an outline would lose.
    if (active === null || e.surface !== 'terminal' || !TYPED.has(e.props.origin.kind) || e.props.text.length > MAX_PROMPT) {
      return next(e)
    }

    const look = lookOf($.ui.resolve(e), active, e.surface, copier($, e.surface))
    const hasImages = await hasImagesOf($, e)

    // Claude Code draws the images; the text is already in the outline above them.
    return promptRow(look, e.props.text, hasImages ? await next({ ...e, props: { ...e.props, text: '' } }) : undefined)
  })

  // While charts are drawn the model learns it can answer with a Mermaid fence. Nothing for a
  // headless run, which draws nothing.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const active = await activeSkin($)
    const isHeadless = e.surfaces.length === 0 || e.traits.includes('bare') || e.traits.includes('print')

    if (active === null || !active.prefs.charts || !active.prefs.hints || isHeadless) {
      return result
    }

    return { sections: [...result.sections, { id: 'skin:charts', text: CHART_HINT, scope: 'session' as const }] }
  })

  // A reply keeps Claude Code's own drawing unless it holds a card or markdown the skin draws.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const active = await activeSkin($)
    const text = e.props.text

    if (active === null) {
      return next(e)
    }

    const segments = replySegments(text, active.prefs, e.surface)

    // A reply skin-code draws is its own, whichever mod's hook runs first; skin-code draws the
    // prose around it through `$.skins.markdown`.
    if (segments === null || (await drawnBySkinCode($, text))) {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    turn.lastColumns = e.viewport?.columns
    const base = await sessionLook($, e, lookOf(ui, active, e.surface, copier($, e.surface)), replyNeeds(text, segments))
    const look = base.svg === undefined ? base : { ...base, isFirstDraw: await firstDraws($, e, active.prefs) }

    // A reply of several blocks can be copied whole, as Claude wrote it.
    return withSettle($, e, replyRows(look, segments, e.viewport?.columns ?? 100, cardSvg(ui, e.surface, active.prefs), segments.length > 1 ? text : undefined))
  })

  // A slash command's output (`/cost`, `/context`, a plugin's) drawn the way a reply is. /skin's
  // own rows are already the skin's.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const active = await activeSkin($)

    if (active === null || !active.prefs.commands || active.prefs.tables === 'off' || e.props.isErrored || e.props.command === 'skin') {
      return next(e)
    }

    const segments = e.props.text.length > MAX_MARKDOWN ? null : commandSegments(e.props.text, e.props.command)

    if (segments === null) {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const base = await sessionLook($, e, lookOf(ui, active, e.surface, copier($, e.surface)), replyNeeds(e.props.text, segments))
    const look = base.svg === undefined ? base : { ...base, isFirstDraw: await firstDraws($, e, active.prefs) }

    return withSettle($, e, replyRows(look, segments, e.viewport?.columns ?? 100, cardSvg(ui, e.surface, active.prefs)))
  })
}
