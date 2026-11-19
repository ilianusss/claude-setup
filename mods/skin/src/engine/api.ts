import type { EngineInterface, On, RenderElement, RenderSurface } from 'claude-code'

import type { SkinsMarkdownArgs } from '../../types'
import { MAX_MARKDOWN, replySegments } from '../markdown/reply'
import { replyRows } from '../ui/reply-rows'
import { activeSkin, cardSvg, lookOf } from './look'
import { live } from './state'

const SURFACES: readonly RenderSurface[] = ['terminal', 'desktop', 'vscode', 'mobile']

// `$.skins.markdown`: markdown drawn the way the skin draws a reply, for another mod. Undefined
// when the skin is off or the text holds nothing it draws. No copy or fold controls: a press
// cannot cross from one mod's tree to another's.
async function drawMarkdown($: EngineInterface, args: SkinsMarkdownArgs): Promise<RenderElement | undefined> {
  if (!SURFACES.includes(args.surface) || typeof args.text !== 'string' || !Number.isFinite(args.columns)) {
    throw new Error('skins.markdown takes { surface, text, columns }: a surface name, a string and a number')
  }

  const active = await activeSkin($)
  const segments = active === null || args.text.length > MAX_MARKDOWN * 4 ? null : replySegments(args.text, active.prefs, args.surface)

  if (active === null || segments === null) {
    return undefined
  }

  const ui = $.ui.resolve({ surface: args.surface, component: 'AssistantMessage' })
  const links = active.prefs.links && (args.surface !== 'terminal' || live.hyperlinks)

  return replyRows(
    { ...lookOf(ui, active, args.surface), links, isFirstDraw: () => false },
    segments,
    Math.max(20, Math.floor(args.columns)),
    cardSvg(ui, args.surface, active.prefs),
  )
}

export function hookApi(on: On): void {
  // A call is the `skins.markdown` event, answered with this session's `$`; the method on `$`
  // itself is the chain's floor.
  on('engine.create', async ($, e, next) => {
    const built = await next(e)

    return { ...built, skins: { markdown: async () => undefined } }
  })

  on('skins.markdown', async ($, e) => ({ value: await drawMarkdown($, e) }))
}
